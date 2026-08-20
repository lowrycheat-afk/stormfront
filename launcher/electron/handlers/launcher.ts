import { ipcMain, BrowserWindow } from 'electron'
import type { Account } from 'eml-lib'
import type { IGameSettings } from './settings'
import path from 'node:path'
import * as fs from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import https from 'node:https'
import http from 'node:http'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import {
  clearStoredSessionToken,
  ensureAuthDataPath,
  gamePath,
  javaInstallPath,
  minecraftAuthPath,
  readStoredSessionToken
} from '../paths'

const customGamePath = gamePath()
const javaPath = javaInstallPath()
const vanillaVersion = '1.20.1'
const preferredForgeVersion = '1.20.1-forge-47.4.10'
const forgeVersionPrefix = `${vanillaVersion}-forge-`
const SITE_ORIGIN = process.env.LASTFRONT_SITE_ORIGIN || 'https://lastfront.ru'
const SITE_MIRROR_ORIGIN = process.env.LASTFRONT_FILE_MIRROR_ORIGIN || 'https://ru.lastfront.ru'
const LEGACY_SITE_ORIGIN = 'https://lastfront.ru'
const DOWNLOAD_IDLE_TIMEOUT_MS = 20_000
const DOWNLOAD_REQUEST_TIMEOUT_MS = 15_000

function configuredUrlList(value: string | undefined, fallback: string[]): string[] {
  const configured = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return configured.length > 0 ? configured : fallback
}

const ASSETS_REPOS = configuredUrlList(process.env.LASTFRONT_ASSET_REPOSITORIES, [
  'https://resources.download.minecraft.net/'
]).map((url) => url.endsWith('/') ? url : `${url}/`)

const VERSIONS_URL = `${SITE_ORIGIN}/versions.zip`
const LIBRARIES_URL = `${SITE_ORIGIN}/libraries.zip`
const MODS_BASE_URL = process.env.LASTFRONT_MODS_BASE_URL || 'https://raw.githubusercontent.com/lowrycheat-afk/stormfront/main/mods'
const MODS_INDEX_URL = process.env.LASTFRONT_MODS_INDEX_URL || 'https://raw.githubusercontent.com/lowrycheat-afk/stormfront/main/mods.json'
const RESOURCEPACKS_BASE_URL = `${SITE_ORIGIN}/resourcepacks`
const RESOURCEPACKS_INDEX_URL = `${SITE_ORIGIN}/resourcepacks.json`
const JAVA_VERSION_FOLDER = 'jdk-17.0.12'
const JAVA_DOWNLOAD_URLS: Record<string, string[]> = {
  win32: configuredUrlList(process.env.LASTFRONT_JAVA_WINDOWS_URLS, [
    'https://download.oracle.com/java/17/archive/jdk-17.0.12_windows-x64_bin.zip'
  ]),
  linux: configuredUrlList(process.env.LASTFRONT_JAVA_LINUX_URLS, [
    'https://download.oracle.com/java/17/archive/jdk-17.0.12_linux-x64_bin.tar.gz'
  ])
}
const SITE_DOWNLOAD_ORIGIN = new URL(SITE_ORIGIN).origin
const TRUSTED_SITE_ORIGINS = new Set([SITE_DOWNLOAD_ORIGIN, new URL(LEGACY_SITE_ORIGIN).origin])
const ACCOUNT_MONITOR_INTERVAL_MS = 30_000
type DownloadRegion = NonNullable<IGameSettings['downloadRegion']>
let activeDownloadRegion: DownloadRegion = 'germany'
let activeSiteMirrorOrigin = SITE_MIRROR_ORIGIN
let activeGameProcess: ChildProcess | null = null
let accountMonitor: ReturnType<typeof setInterval> | null = null
let accountInvalidationInProgress = false

interface ModInfo {
  name: string
  hash: string
  size: number
}

interface ResourcePackInfo {
  name: string
  hash: string
  size: number
}

interface MinecraftLaunchTicket {
  launchId: string
  username: string
  uuid: string
  expiresAt: string
}

interface Library {
  name: string
  downloads?: {
    artifact?: {
      path: string
      url: string
    }
    classifiers?: Record<string, {
      path: string
      url: string
    }>
  }
  natives?: Record<string, string>
  rules?: Array<{
    action: string
    os?: { name: string }
  }>
}

function parseLibraryPath(libName: string): string {
  const parts = libName.split(':')
  if (parts.length < 3) return ''

  const [group, artifact, version] = parts
  const groupPath = group.replace(/\./g, '/')
  return `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`
}

function minecraftOsName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

function shouldIncludeLibrary(lib: Library): boolean {
  if (lib.rules) {
    for (const rule of lib.rules) {
      if (rule.action === 'allow' && rule.os) {
        return rule.os.name === minecraftOsName()
      }
      if (rule.action === 'disallow' && rule.os) {
        return rule.os.name !== minecraftOsName()
      }
    }
  }
  return true
}

function nativeClassifier(lib: Library): string | null {
  const classifier = lib.natives?.[minecraftOsName()]
  if (!classifier) return null

  const arch = process.arch === 'x64' || process.arch === 'arm64' ? '64' : '32'
  return classifier.replace('${arch}', arch)
}

function getLibrariesFromJson(versionJsonPath: string, librariesPath: string): string[] {
  try {
    const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'))
    const libs: string[] = []

    if (versionData.libraries) {
      for (const lib of versionData.libraries as Library[]) {
        if (lib.natives || !shouldIncludeLibrary(lib)) {
          continue
        }

        let libPath = ''
        if (lib.downloads?.artifact?.path) {
          libPath = path.join(librariesPath, lib.downloads.artifact.path)
        } else if (lib.name) {
          libPath = path.join(librariesPath, parseLibraryPath(lib.name))
        }

        if (libPath && fs.existsSync(libPath)) {
          libs.push(libPath)
        }
      }
    }

    return libs
  } catch (error) {
    console.error('Failed to parse version JSON:', error)
    return []
  }
}

function getNativeLibrariesFromJson(versionJsonPath: string, librariesPath: string): string[] {
  try {
    const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'))
    const libs: string[] = []

    if (versionData.libraries) {
      for (const lib of versionData.libraries as Library[]) {
        if (!lib.natives || !shouldIncludeLibrary(lib)) {
          continue
        }

        const classifier = nativeClassifier(lib)
        const classifierPath = classifier ? lib.downloads?.classifiers?.[classifier]?.path : null
        if (!classifierPath) continue

        const libPath = path.join(librariesPath, classifierPath)
        if (fs.existsSync(libPath)) {
          libs.push(libPath)
        }
      }
    }

    return libs
  } catch (error) {
    console.error('Failed to parse native libraries:', error)
    return []
  }
}

function extractNativeLibraries(versionJsonPaths: string[], librariesPath: string, nativesPath: string) {
  fs.rmSync(nativesPath, { recursive: true, force: true })
  fs.mkdirSync(nativesPath, { recursive: true })

  const nativeJars = new Set<string>()
  for (const versionJsonPath of versionJsonPaths) {
    for (const nativeJar of getNativeLibrariesFromJson(versionJsonPath, librariesPath)) {
      nativeJars.add(nativeJar)
    }
  }

  for (const nativeJar of nativeJars) {
    const zip = new AdmZip(nativeJar)
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || entry.entryName.startsWith('META-INF/')) {
        continue
      }

      zip.extractEntryTo(entry, nativesPath, false, true)
    }
  }
}

function replaceArgVariables(arg: string, vars: Record<string, string>): string {
  let result = arg
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value)
  }
  return result
}

function resolveForgeVersion(versionsDir: string): string | null {
  const preferredPath = path.join(versionsDir, preferredForgeVersion, `${preferredForgeVersion}.json`)
  if (fs.existsSync(preferredPath)) {
    return preferredForgeVersion
  }

  if (!fs.existsSync(versionsDir)) {
    return null
  }

  const forgeCandidates = fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(forgeVersionPrefix))
    .map((entry) => entry.name)
    .filter((version) => fs.existsSync(path.join(versionsDir, version, `${version}.json`)))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))

  return forgeCandidates[0] ?? null
}

function requestHeaders(url: string, extra: Record<string, string> = {}): Record<string, string> {
  try {
    if (!TRUSTED_SITE_ORIGINS.has(new URL(url).origin)) return extra
  } catch {
    return extra
  }

  const token = readStoredSessionToken()
  return token ? { ...extra, 'x-lastfront-session': token } : extra
}

function requestUrl(url: string, redirectsLeft = 5, headers: Record<string, string> = {}): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http

    const request = protocol.get(url, { headers: requestHeaders(url, headers) }, (response) => {
      const statusCode = response.statusCode ?? 0
      const redirectUrl = response.headers.location

      if ([301, 302, 303, 307, 308].includes(statusCode) && redirectUrl) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while requesting ${url}`))
          return
        }

        const nextUrl = new URL(redirectUrl, url).toString()
        requestUrl(nextUrl, redirectsLeft - 1, headers).then(resolve).catch(reject)
        return
      }

      response.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
        response.destroy(new Error(`Download stalled for ${DOWNLOAD_IDLE_TIMEOUT_MS} ms`))
      })
      resolve(response)
    })

    request.setTimeout(DOWNLOAD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${DOWNLOAD_REQUEST_TIMEOUT_MS} ms`))
    })
    request.on('error', reject)
  })
}

function siteMirrorUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!activeSiteMirrorOrigin || parsed.origin !== SITE_DOWNLOAD_ORIGIN) return ''
    return new URL(`${parsed.pathname}${parsed.search}`, activeSiteMirrorOrigin).toString()
  } catch {
    return ''
  }
}

function downloadCandidates(url: string): string[] {
  const mirrorUrl = siteMirrorUrl(url)
  const candidates = activeDownloadRegion === 'russia'
    ? [mirrorUrl, url]
    : [url, mirrorUrl]
  return [...new Set(candidates.filter(Boolean))]
}

function logDownloadSource(url: string) {
  try {
    const parsed = new URL(url)
    console.log(`Download source: ${parsed.origin} (${activeDownloadRegion})`)
  } catch {
    console.log(`Download source: ${url} (${activeDownloadRegion})`)
  }
}

function responseTotalSize(response: http.IncomingMessage, resumedFrom: number): number {
  const contentRange = String(response.headers['content-range'] || '')
  const rangeMatch = contentRange.match(/^bytes\s+\d+-\d+\/(\d+)$/i)
  if (rangeMatch) return Number(rangeMatch[1])
  const length = Number(response.headers['content-length'] || 0)
  return Number.isFinite(length) && length > 0 ? resumedFrom + length : 0
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const partialPath = `${dest}.part`
  const sourcePath = `${partialPath}.source`
  const sourceKey = new URL(url).origin
  const previousSource = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf-8').trim() : ''
  if (fs.existsSync(partialPath) && previousSource !== sourceKey) {
    fs.rmSync(partialPath, { force: true })
  }
  fs.writeFileSync(sourcePath, sourceKey, 'utf-8')

  const existingSize = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0
  const headers: Record<string, string> = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {}
  const response = await requestUrl(url, 5, headers)

  if (response.statusCode === 416 && existingSize > 0) {
    const totalMatch = String(response.headers['content-range'] || '').match(/^bytes\s+\*\/(\d+)$/i)
    if (totalMatch && Number(totalMatch[1]) === existingSize) {
      fs.rmSync(dest, { force: true })
      fs.renameSync(partialPath, dest)
      fs.rmSync(sourcePath, { force: true })
      return
    }
  }

  if (![200, 206].includes(response.statusCode || 0)) {
    response.resume()
    throw new Error(`Failed to download ${url}: HTTP ${response.statusCode}`)
  }

  const resumedFrom = response.statusCode === 206 ? existingSize : 0
  if (response.statusCode === 206) {
    const contentRange = String(response.headers['content-range'] || '')
    if (!contentRange.startsWith(`bytes ${existingSize}-`)) {
      response.destroy()
      throw new Error(`Invalid Content-Range while downloading ${url}`)
    }
  }

  const totalSize = responseTotalSize(response, resumedFrom)
  let downloadedSize = resumedFrom
  response.on('data', (chunk) => {
    downloadedSize += chunk.length
    onProgress?.(downloadedSize, totalSize)
  })

  const file = fs.createWriteStream(partialPath, { flags: resumedFrom > 0 ? 'a' : 'w' })
  await pipeline(response, file)

  const finalSize = fs.statSync(partialPath).size
  if (totalSize > 0 && finalSize !== totalSize) {
    throw new Error(`Incomplete download from ${url}: expected ${totalSize} bytes, received ${finalSize}`)
  }

  fs.rmSync(dest, { force: true })
  fs.renameSync(partialPath, dest)
  fs.rmSync(sourcePath, { force: true })
}

async function downloadFileWithProgress(url: string, dest: string, mainWindow: BrowserWindow, label: string): Promise<void> {
  await downloadFile(url, dest, (downloadedSize, totalSize) => {
    if (totalSize <= 0 || mainWindow.isDestroyed()) return
    const percent = Math.min(100, Math.round((downloadedSize / totalSize) * 100))
    mainWindow.webContents.send('game:download_progress', {
      label,
      downloaded: downloadedSize,
      total: totalSize,
      percent
    })
  })
}

async function downloadFileWithProgressFromAny(url: string, dest: string, mainWindow: BrowserWindow, label: string): Promise<void> {
  let lastError: unknown = null
  for (const candidate of downloadCandidates(url)) {
    logDownloadSource(candidate)
    try {
      await downloadFileWithProgress(candidate, dest, mainWindow, label)
      return
    } catch (error) {
      lastError = error
      console.warn(`Download failed from ${candidate}:`, error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to download from all sources')
}

async function downloadText(url: string): Promise<string> {
  const response = await requestUrl(url)
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`Failed to download text: ${response.statusCode}`)
  }

  return await new Promise((resolve, reject) => {
    let data = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => data += chunk)
    response.on('end', () => resolve(data))
    response.on('error', reject)
  })
}

async function downloadTextFromAny(url: string): Promise<string> {
  let lastError: unknown = null
  for (const candidate of downloadCandidates(url)) {
    logDownloadSource(candidate)
    try {
      return await downloadText(candidate)
    } catch (error) {
      lastError = error
      console.warn(`Text download failed from ${candidate}:`, error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to download text from all sources')
}

function requestSiteJson(
  method: 'GET' | 'POST',
  pathname: string,
  payload: Record<string, unknown> | null,
  token: string
): Promise<{ response: { ok: boolean; status: number }; data: any }> {
  const url = new URL(pathname, SITE_ORIGIN)
  const body = payload ? Buffer.from(JSON.stringify(payload), 'utf-8') : null
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'x-lastfront-session': token
  }

  if (body) {
    headers['Content-Type'] = 'application/json; charset=utf-8'
    headers['Content-Length'] = String(body.length)
  }

  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method,
      headers
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let data: any = {}
        try {
          data = text ? JSON.parse(text) : {}
        } catch {
          data = { error: 'invalid_json' }
        }
        const status = response.statusCode || 0
        resolve({ response: { ok: status >= 200 && status < 300, status }, data })
      })
    })

    request.setTimeout(15000, () => request.destroy(new Error('request_timeout')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function requestJson(pathname: string, payload: Record<string, unknown>, token: string): Promise<{ response: { ok: boolean; status: number }; data: any }> {
  return requestSiteJson('POST', pathname, payload, token)
}

function requestAccountStatus(token: string): Promise<{ response: { ok: boolean; status: number }; data: any }> {
  return requestSiteJson('GET', '/api/auth/me', null, token)
}

function isInvalidAccountResponse(status: number, data: any): boolean {
  const error = String(data?.error || '').trim()
  return [401, 403].includes(status) && ['account_banned', 'not_authenticated', 'invalid_session'].includes(error)
}

function stopAccountMonitor() {
  if (accountMonitor) {
    clearInterval(accountMonitor)
    accountMonitor = null
  }
}

function killGameProcess(processToKill: ChildProcess | null) {
  const pid = processToKill?.pid
  if (!pid) return

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    } else {
      process.kill(-pid, 'SIGTERM')
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
        }
      }, 3000)
    }
  } catch {
    try {
      processToKill.kill('SIGKILL')
    } catch {
    }
  }
}

async function invalidateGameAccount(mainWindow: BrowserWindow, reason: string) {
  if (accountInvalidationInProgress) return
  accountInvalidationInProgress = true
  stopAccountMonitor()
  clearStoredSessionToken()
  killGameProcess(activeGameProcess)
  activeGameProcess = null

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game:account_invalidated', { reason })
    mainWindow.webContents.send('game:launch_close', { error: reason })
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  accountInvalidationInProgress = false
}

function startAccountMonitor(mainWindow: BrowserWindow, token: string) {
  stopAccountMonitor()
  accountMonitor = setInterval(() => {
    void requestAccountStatus(token)
      .then(({ response, data }) => {
        if (isInvalidAccountResponse(response.status, data)) {
          void invalidateGameAccount(mainWindow, String(data?.error || 'not_authenticated'))
        }
      })
      .catch((error) => {
        console.warn('Account monitor check failed:', error)
      })
  }, ACCOUNT_MONITOR_INTERVAL_MS)
}

async function createMinecraftAuthProof(account: Account): Promise<string> {
  const sessionToken = readStoredSessionToken()
  if (!sessionToken) {
    throw new Error('LastFront session is missing. Sign in again.')
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer

  const { response, data } = await requestJson('/api/minecraft/auth/launch', {
    username: account.name,
    uuid: account.uuid,
    publicKey: publicKeyDer.toString('base64url'),
    clientVersion: 'LastFrontLauncher/1.0'
  }, sessionToken)

  if (!response.ok || !data?.launchId) {
    throw new Error(`LastFront auth launch failed: ${data?.error || response.status}`)
  }

  const ticket = data as MinecraftLaunchTicket
  ensureAuthDataPath()

  const authPath = minecraftAuthPath()
  const authPayload = {
    launchId: ticket.launchId,
    privateKey: privateKeyDer.toString('base64url'),
    username: ticket.username,
    uuid: ticket.uuid,
    expiresAt: ticket.expiresAt
  }

  fs.writeFileSync(authPath, JSON.stringify(authPayload), { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.chmodSync(authPath, 0o600)
  } catch {
    // Windows may ignore POSIX permissions; the key is still launch-scoped.
  }

  return authPath
}

async function downloadAndExtractZip(url: string, destDir: string, mainWindow: BrowserWindow, label: string): Promise<void> {
  const tempZip = path.join(destDir, `${label}.zip`)
  
  try {
    // Download zip file
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `Downloading ${label}...`)
    }
    await downloadFileWithProgressFromAny(url, tempZip, mainWindow, label)
    
    // Extract zip file
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `Extracting ${label}...`)
    }
    const zip = new AdmZip(tempZip)
    zip.extractAllTo(destDir, true)
    
    // Delete temp zip
    fs.unlinkSync(tempZip)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `${label} installed successfully`)
    }
  } catch (error) {
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip)
    }
    throw error
  }
}

async function checkAndDownloadVersions(mainWindow: BrowserWindow): Promise<void> {
  const versionsDir = path.join(customGamePath, 'versions')
  const vanillaVersionPath = path.join(versionsDir, vanillaVersion)
  const resolvedForgeVersion = resolveForgeVersion(versionsDir)
  
  // Check if versions exist
  const forgeExists = Boolean(resolvedForgeVersion)
  const vanillaExists = fs.existsSync(path.join(vanillaVersionPath, `${vanillaVersion}.json`))
  
  if (!forgeExists || !vanillaExists) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Game versions not found, downloading...')
    }
    await downloadAndExtractZip(VERSIONS_URL, customGamePath, mainWindow, 'versions')
  } else {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Game versions are present')
    }
  }
}

async function checkAndDownloadLibraries(mainWindow: BrowserWindow): Promise<void> {
  const librariesDir = path.join(customGamePath, 'libraries')
  
  // Check if libraries directory exists and has content
  const librariesExist = fs.existsSync(librariesDir) && fs.readdirSync(librariesDir).length > 0
  
  if (!librariesExist) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Game libraries not found, downloading...')
    }
    await downloadAndExtractZip(LIBRARIES_URL, customGamePath, mainWindow, 'libraries')
  } else {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Game libraries are present')
    }
  }
}

async function checkAndDownloadJava(mainWindow: BrowserWindow): Promise<string> {
  const javaDir = javaPath
  const javaExe = path.join(javaDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  
  // Check if Java already exists
  if (fs.existsSync(javaExe)) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Java is present')
    }
    return javaExe
  }
  
  // Download Java
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game:launch_data', 'Java not found, downloading...')
  }
  
  // Create java directory
  if (!fs.existsSync(javaDir)) {
    fs.mkdirSync(javaDir, { recursive: true })
  }
  
  const javaDownloadUrls = JAVA_DOWNLOAD_URLS[process.platform]
  if (!javaDownloadUrls?.length) {
    throw new Error(`Bundled Java download is not configured for ${process.platform}`)
  }

  const javaArchivePath = path.join(javaDir, process.platform === 'win32' ? 'java.zip' : 'java.tar.gz')
  const tempExtractDir = path.join(javaDir, 'temp')
  
  try {
    let javaDownloadError: unknown = null
    for (const javaDownloadUrl of javaDownloadUrls) {
      try {
        await downloadFileWithProgress(javaDownloadUrl, javaArchivePath, mainWindow, 'Java')
        javaDownloadError = null
        break
      } catch (error) {
        javaDownloadError = error
        console.warn(`Java download failed from ${javaDownloadUrl}:`, error)
      }
    }
    if (javaDownloadError) throw javaDownloadError
    
    // Extract Java to temp directory
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Extracting Java...')
    }
    
    if (process.platform === 'win32') {
      const zip = new AdmZip(javaArchivePath)
      zip.extractAllTo(tempExtractDir, true)
    } else {
      fs.mkdirSync(tempExtractDir, { recursive: true })
      const tar = spawnSync('tar', ['-xzf', javaArchivePath, '-C', tempExtractDir], { stdio: 'ignore' })
      if (tar.status !== 0) {
        throw new Error('tar extraction failed')
      }
    }
    
    // Move contents from the extracted JDK folder to java directory
    const jdkFolder = path.join(tempExtractDir, JAVA_VERSION_FOLDER)
    if (fs.existsSync(jdkFolder)) {
      const items = fs.readdirSync(jdkFolder)
      for (const item of items) {
        const srcPath = path.join(jdkFolder, item)
        const destPath = path.join(javaDir, item)
        fs.renameSync(srcPath, destPath)
      }
    }
    
    // Clean up temp directory and zip
    fs.rmSync(tempExtractDir, { recursive: true, force: true })
    fs.unlinkSync(javaArchivePath)

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(javaExe, 0o755)
      } catch {
      }
    }
    
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Java installed successfully')
    }
    
    return javaExe
  } catch (error) {
    console.error('Failed to download Java:', error)
    if (fs.existsSync(javaArchivePath)) {
      fs.unlinkSync(javaArchivePath)
    }
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true })
    }
    throw new Error('Failed to download Java')
  }
}

function getFileHash(filePath: string): string {
  const crypto = require('crypto')
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha1')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

async function downloadMods(mainWindow: BrowserWindow): Promise<void> {
  const modsDir = path.join(customGamePath, 'mods')
  
  // Create mods directory if it doesn't exist
  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true })
  }

  try {
    // Download mods index
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Checking mods...')
    }
    
    const indexResponse = await downloadTextFromAny(MODS_INDEX_URL)

    const serverMods: ModInfo[] = JSON.parse(indexResponse)
    
    // Get local mods
    const localMods = fs.readdirSync(modsDir).filter(file => file.endsWith('.jar'))
    
    // Create a set of valid server mod names for quick lookup
    const serverModNames = new Set(serverMods.map(mod => mod.name))
    
    // Delete ALL mods that are not in server list OR have wrong hash
    for (const modFile of localMods) {
      const modPath = path.join(modsDir, modFile)
      
      // If mod is not in server list, delete it
      if (!serverModNames.has(modFile)) {
        fs.unlinkSync(modPath)
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:launch_data', `Removed unauthorized mod: ${modFile}`)
        }
        continue
      }
      
      // If mod is in server list, check hash
      const serverMod = serverMods.find(m => m.name === modFile)
      if (serverMod) {
        const localHash = getFileHash(modPath)
        if (localHash !== serverMod.hash) {
          fs.unlinkSync(modPath)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:launch_data', `Removed corrupted mod: ${modFile}`)
          }
        }
      }
    }

    // Find mods to download (check which server mods are missing or were deleted)
    const modsToDownload: ModInfo[] = []
    for (const serverMod of serverMods) {
      const modPath = path.join(modsDir, serverMod.name)
      
      // If mod doesn't exist, download it
      if (!fs.existsSync(modPath)) {
        modsToDownload.push(serverMod)
      }
    }

    // Download/update mods
    if (modsToDownload.length > 0) {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', `Downloading ${modsToDownload.length} mods...`)
      }
      
      for (let i = 0; i < modsToDownload.length; i++) {
        const mod = modsToDownload[i]
        const modUrl = `${MODS_BASE_URL}/${mod.name}`
        const modPath = path.join(modsDir, mod.name)
        
        // Delete old version if exists
        if (fs.existsSync(modPath)) {
          fs.unlinkSync(modPath)
        }
        
        try {
          await downloadFileWithProgressFromAny(modUrl, modPath, mainWindow, 'mods')
          
          // Verify hash - strict check
          const downloadedHash = getFileHash(modPath)
          if (downloadedHash !== mod.hash) {
            fs.unlinkSync(modPath)
            throw new Error(`Hash mismatch for ${mod.name}. Expected: ${mod.hash}, Got: ${downloadedHash}`)
          }
          
          const percent = Math.round(((i + 1) / modsToDownload.length) * 100)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:mods_progress', {
              current: i + 1,
              total: modsToDownload.length,
              percent
            })
          }
        } catch (error) {
          console.error(`Failed to download mod ${mod.name}:`, error)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:launch_data', `Failed to download mod: ${mod.name}`)
          }
        }
      }
      
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', `Downloaded ${modsToDownload.length} mods`)
      }
    } else {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', 'All mods are up to date')
      }
    }
  } catch (error) {
    console.error('Failed to sync mods:', error)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Failed to sync mods, continuing...')
    }
  }
}

async function downloadResourcePacks(mainWindow: BrowserWindow): Promise<void> {
  const resourcepacksDir = path.join(customGamePath, 'resourcepacks')
  
  // Create resourcepacks directory if it doesn't exist
  if (!fs.existsSync(resourcepacksDir)) {
    fs.mkdirSync(resourcepacksDir, { recursive: true })
  }

  try {
    // Download resourcepacks index
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Checking resource packs...')
    }
    
    const indexResponse = await downloadTextFromAny(RESOURCEPACKS_INDEX_URL)

    const serverPacks: ResourcePackInfo[] = JSON.parse(indexResponse)
    
    // Get local resourcepacks
    const localPacks = fs.readdirSync(resourcepacksDir).filter(file => file.endsWith('.zip'))
    
    // Check hash for packs that exist on server (but don't delete if not on server)
    for (const packFile of localPacks) {
      const packPath = path.join(resourcepacksDir, packFile)
      
      // If pack is in server list, check hash
      const serverPack = serverPacks.find(p => p.name === packFile)
      if (serverPack) {
        const localHash = getFileHash(packPath)
        if (localHash !== serverPack.hash) {
          fs.unlinkSync(packPath)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:launch_data', `Removed corrupted resource pack: ${packFile}`)
          }
        }
      }
      // If pack is NOT in server list, we keep it (user's custom resource pack)
    }

    // Find packs to download (check which server packs are missing or were deleted)
    const packsToDownload: ResourcePackInfo[] = []
    for (const serverPack of serverPacks) {
      const packPath = path.join(resourcepacksDir, serverPack.name)
      
      // If pack doesn't exist, download it
      if (!fs.existsSync(packPath)) {
        packsToDownload.push(serverPack)
      }
    }

    // Download/update resourcepacks
    if (packsToDownload.length > 0) {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', `Downloading ${packsToDownload.length} resource packs...`)
      }
      
      for (let i = 0; i < packsToDownload.length; i++) {
        const pack = packsToDownload[i]
        const packUrl = `${RESOURCEPACKS_BASE_URL}/${pack.name}`
        const packPath = path.join(resourcepacksDir, pack.name)
        
        // Delete old version if exists
        if (fs.existsSync(packPath)) {
          fs.unlinkSync(packPath)
        }
        
        try {
          await downloadFileWithProgressFromAny(packUrl, packPath, mainWindow, 'resourcepacks')
          
          // Verify hash - strict check
          const downloadedHash = getFileHash(packPath)
          if (downloadedHash !== pack.hash) {
            fs.unlinkSync(packPath)
            throw new Error(`Hash mismatch for ${pack.name}. Expected: ${pack.hash}, Got: ${downloadedHash}`)
          }
          
          const percent = Math.round(((i + 1) / packsToDownload.length) * 100)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:resourcepacks_progress', {
              current: i + 1,
              total: packsToDownload.length,
              percent
            })
          }
        } catch (error) {
          console.error(`Failed to download resource pack ${pack.name}:`, error)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('game:launch_data', `Failed to download resource pack: ${pack.name}`)
          }
        }
      }
      
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', `Downloaded ${packsToDownload.length} resource packs`)
      }
    } else {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', 'All resource packs are up to date')
      }
    }
  } catch (error) {
    console.error('Failed to sync resource packs:', error)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', 'Failed to sync resource packs, continuing...')
    }
  }
}

async function downloadAssets(assetsDir: string, assetIndexId: string, assetIndexUrl: string, mainWindow: BrowserWindow): Promise<void> {
  const indexesDir = path.join(assetsDir, 'indexes')
  const objectsDir = path.join(assetsDir, 'objects')
  const indexFile = path.join(indexesDir, `${assetIndexId}.json`)

  // Create directories
  if (!fs.existsSync(indexesDir)) {
    fs.mkdirSync(indexesDir, { recursive: true })
  }
  if (!fs.existsSync(objectsDir)) {
    fs.mkdirSync(objectsDir, { recursive: true })
  }

  // Download asset index if missing
  if (!fs.existsSync(indexFile)) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `Downloading asset index ${assetIndexId}...`)
    }
    
    // Use URL from version JSON if available
    if (assetIndexUrl) {
      try {
        await downloadFile(assetIndexUrl, indexFile)
      } catch (error) {
        console.error('Failed to download asset index from version URL:', error)
        // Fallback to repository
        const repoUrl = `https://piston-meta.mojang.com/v1/packages/${assetIndexId}/${assetIndexId}.json`
        await downloadFile(repoUrl, indexFile)
      }
    } else {
      // Try repository URLs
      const urls = [
        `https://piston-meta.mojang.com/v1/packages/${assetIndexId}/${assetIndexId}.json`,
        `https://launchermeta.mojang.com/v1/packages/${assetIndexId}/${assetIndexId}.json`
      ]
      
      let success = false
      for (const url of urls) {
        try {
          await downloadFile(url, indexFile)
          success = true
          break
        } catch (error) {
          continue
        }
      }
      
      if (!success) {
        throw new Error('Failed to download asset index from all sources')
      }
    }
  }

  // Read asset index
  const assetIndex = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
  const objects = assetIndex.objects || {}
  const totalAssets = Object.keys(objects).length
  let downloaded = 0
  let skipped = 0
  const failedAssets: string[] = []

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game:launch_data', `Checking ${totalAssets} assets...`)
  }

  // Download missing assets
  for (const [assetPath, assetData] of Object.entries(objects)) {
    const hash = (assetData as any).hash
    const size = (assetData as any).size
    const hashPrefix = hash.substring(0, 2)
    const assetFile = path.join(objectsDir, hashPrefix, hash)

    // Check if file exists and has correct size
    if (fs.existsSync(assetFile)) {
      const stats = fs.statSync(assetFile)
      if (stats.size === size) {
        skipped++
        continue
      }
    }

    // Create directory for asset
    const assetFileDir = path.dirname(assetFile)
    if (!fs.existsSync(assetFileDir)) {
      fs.mkdirSync(assetFileDir, { recursive: true })
    }

    // Try downloading from repos
    let success = false
    for (const repo of ASSETS_REPOS) {
      try {
        const url = `${repo}${hashPrefix}/${hash}`
        await downloadFile(url, assetFile)
        const downloadedSize = fs.statSync(assetFile).size
        if (Number.isFinite(size) && downloadedSize !== size) {
          fs.rmSync(assetFile, { force: true })
          throw new Error(`Asset size mismatch: expected ${size}, received ${downloadedSize}`)
        }
        downloaded++
        
        // Send progress update
        const progress = Math.round(((downloaded + skipped) / totalAssets) * 100)
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:assets_progress', {
            downloaded,
            skipped,
            total: totalAssets,
            percent: progress
          })
        }
        
        success = true
        break
      } catch (error) {
        continue
      }
    }

    if (!success) {
      console.error(`Failed to download asset: ${assetPath} (${hash})`)
      failedAssets.push(String(assetPath))
    }
  }

  if (failedAssets.length > 0) {
    throw new Error(`Failed to download ${failedAssets.length} game assets (first: ${failedAssets[0]})`)
  }

  if (downloaded > 0) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `Downloaded ${downloaded} new assets, ${skipped} already present`)
    }
  } else {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:launch_data', `All ${totalAssets} assets are present`)
    }
  }
}

export function registerLauncherHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('game:launch', async (_event, payload: { account: Account; settings: IGameSettings }) => {
    const { account, settings } = payload
    activeDownloadRegion = settings.downloadRegion === 'russia' ? 'russia' : 'germany'
    activeSiteMirrorOrigin = SITE_MIRROR_ORIGIN

    try {
      if (activeGameProcess && !activeGameProcess.killed) {
        throw new Error('Game is already running.')
      }

      // Create game directory if it doesn't exist
      if (!fs.existsSync(customGamePath)) {
        fs.mkdirSync(customGamePath, { recursive: true })
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:launch_data', 'Created game directory')
        }
      }

      // Check and download Java if needed
      const javaExecutable = await checkAndDownloadJava(mainWindow)

      const minMem = parseInt(settings.memory.min.replace('G', '')) * 1024
      const maxMem = parseInt(settings.memory.max.replace('G', '')) * 1024

      // Check and download versions if needed
      await checkAndDownloadVersions(mainWindow)
      
      // Check and download libraries if needed
      await checkAndDownloadLibraries(mainWindow)
      
      // Sync mods with server
      await downloadMods(mainWindow)
      
      // Sync resource packs with server
      await downloadResourcePacks(mainWindow)

      const versionsDir = path.join(customGamePath, 'versions')
      const forgeVersion = resolveForgeVersion(versionsDir)
      const librariesPath = path.join(customGamePath, 'libraries')
      const vanillaVersionPath = path.join(versionsDir, vanillaVersion)

      if (!forgeVersion) {
        throw new Error(`Forge JSON not found. Expected ${preferredForgeVersion} or another ${forgeVersionPrefix}* version in ${versionsDir}`)
      }

      const forgeVersionPath = path.join(versionsDir, forgeVersion)
      const forgeJsonPath = path.join(forgeVersionPath, `${forgeVersion}.json`)
      const vanillaJsonPath = path.join(vanillaVersionPath, `${vanillaVersion}.json`)
      const vanillaJar = path.join(vanillaVersionPath, `${vanillaVersion}.jar`)
      const nativesPath = path.join(vanillaVersionPath, 'natives')

      if (!fs.existsSync(forgeJsonPath)) {
        throw new Error('Forge JSON not found.')
      }

      if (!fs.existsSync(vanillaJsonPath)) {
        throw new Error('Vanilla JSON not found.')
      }

      if (!fs.existsSync(vanillaJar)) {
        throw new Error('Vanilla JAR not found.')
      }

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_extract_natives')
      }
      extractNativeLibraries([vanillaJsonPath, forgeJsonPath], librariesPath, nativesPath)

      // Read both JSON files
      const forgeData = JSON.parse(fs.readFileSync(forgeJsonPath, 'utf-8'))
      const vanillaData = JSON.parse(fs.readFileSync(vanillaJsonPath, 'utf-8'))

      // Get asset index
      const assetIndexId = vanillaData.assetIndex?.id || vanillaData.assets || '5'
      const assetIndexUrl = vanillaData.assetIndex?.url || ''
      const assetsDir = path.join(customGamePath, 'assets')

      // Download assets if needed
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', 'Checking game assets...')
      }
      await downloadAssets(assetsDir, assetIndexId, assetIndexUrl, mainWindow)
      const authProofPath = await createMinecraftAuthProof(account)
      const sessionToken = readStoredSessionToken()
      if (!sessionToken) {
        throw new Error('LastFront session is missing. Sign in again.')
      }

      // Get libraries from both versions and combine them
      const vanillaLibs = getLibrariesFromJson(vanillaJsonPath, librariesPath)
      const forgeLibs = getLibrariesFromJson(forgeJsonPath, librariesPath)

      // Combine and remove duplicates - Forge libs take priority
      const allLibsMap = new Map<string, string>()

      // Add vanilla libs first
      for (const lib of vanillaLibs) {
        const fileName = path.basename(lib)
        allLibsMap.set(fileName, lib)
      }

      // Add forge libs (will override vanilla if same filename)
      for (const lib of forgeLibs) {
        const fileName = path.basename(lib)
        allLibsMap.set(fileName, lib)
      }

      // Build legacy classpath (DON'T include vanilla jar - Forge loads it via inheritsFrom)
      const legacyClassPath = [...allLibsMap.values()].join(path.delimiter)

      // Variables for argument replacement
      const argVars: Record<string, string> = {
        'library_directory': librariesPath,
        'classpath_separator': path.delimiter,
        'version_name': forgeVersion
      }

      // Build JVM arguments
      const jvmArgs = [
        `-Xms${minMem}M`,
        `-Xmx${maxMem}M`,
        `-Djava.library.path=${nativesPath}`,
        `-Djna.tmpdir=${nativesPath}`,
        `-Dorg.lwjgl.system.SharedLibraryExtractPath=${nativesPath}`,
        `-Dio.netty.native.workdir=${nativesPath}`,
        `-Dminecraft.launcher.brand=LastFront`,
        `-Dminecraft.launcher.version=1.0`,
        `-Dlastfront.auth.file=${authProofPath}`,
        `-DlegacyClassPath=${legacyClassPath}`,
      ]

      // Add Forge JVM arguments (these include module path setup)
      if (forgeData.arguments?.jvm) {
        for (const arg of forgeData.arguments.jvm) {
          if (typeof arg === 'string') {
            jvmArgs.push(replaceArgVariables(arg, argVars))
          }
        }
      }

      // Main class
      const mainClass = forgeData.mainClass || 'cpw.mods.bootstraplauncher.BootstrapLauncher'
      jvmArgs.push(mainClass)

      // Game arguments
      const gameArgs: string[] = []

      // Add Forge game arguments
      if (forgeData.arguments?.game) {
        for (const arg of forgeData.arguments.game) {
          if (typeof arg === 'string') {
            gameArgs.push(arg)
          }
        }
      }

      // Add standard game arguments
      gameArgs.push(
        '--version', forgeVersion,
        '--gameDir', customGamePath,
        '--assetsDir', assetsDir,
        '--assetIndex', assetIndexId,
        '--username', account.name,
        '--accessToken', '0',
        '--clientId', '0',
        '--xuid', '0',
        '--userType', 'legacy',
        '--width', settings.resolution.width.toString(),
        '--height', settings.resolution.height.toString()
      )

      if (settings.resolution.fullscreen) {
        gameArgs.push('--fullscreen')
      }

      const args = [...jvmArgs, ...gameArgs]

      const gameProcess = spawn(javaExecutable, args, {
        cwd: customGamePath,
        stdio: 'ignore',
        detached: true,
        windowsHide: process.platform === 'win32' ? false : undefined,
        env: {
          ...process.env,
          LASTFRONT_AUTH_FILE: authProofPath
        }
      })

      activeGameProcess = gameProcess
      startAccountMonitor(mainWindow, sessionToken)

      gameProcess.once('exit', () => {
        if (activeGameProcess !== gameProcess) return
        activeGameProcess = null
        stopAccountMonitor()

        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:launch_close', {})
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
        }
      })

      setTimeout(() => {
        if (activeGameProcess === gameProcess && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('game:launched')
          mainWindow.hide()
        }
      }, 2000)
    } catch (error) {
      console.error('Launch error:', error)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:launch_data', `Launch failed: ${error instanceof Error ? error.message : String(error)}`)
        mainWindow.webContents.send('game:launch_close', { error: error instanceof Error ? error.message : String(error) })
      }
    }
  })
}
