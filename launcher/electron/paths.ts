import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const APP_DIR_NAME = 'StormFront'
const LEGACY_WINDOWS_ROOT = path.join('C:', APP_DIR_NAME)

function linuxDataRoot(): string {
  const xdgDataHome = String(process.env.XDG_DATA_HOME || '').trim()
  return xdgDataHome || path.join(os.homedir(), '.local', 'share')
}

export function dataRootPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_DIR_NAME)
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME)
  }

  return path.join(linuxDataRoot(), APP_DIR_NAME)
}

export function gamePath(): string {
  if (process.platform === 'win32') {
    return path.join(LEGACY_WINDOWS_ROOT, 'game')
  }

  return path.join(dataRootPath(), 'game')
}

export function javaInstallPath(): string {
  if (process.platform === 'win32') {
    return path.join(LEGACY_WINDOWS_ROOT, 'java')
  }

  return path.join(dataRootPath(), 'java')
}

export function authDataPath(): string {
  return path.join(dataRootPath(), 'auth')
}

export function settingsPath(): string {
  return path.join(dataRootPath(), 'settings.json')
}

export function sessionPath(): string {
  return path.join(authDataPath(), 'auth-session.json')
}

export function minecraftAuthPath(): string {
  return path.join(authDataPath(), 'minecraft-auth.json')
}

function legacySessionPath(): string {
  return path.join(LEGACY_WINDOWS_ROOT, 'auth-session.json')
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function ensureDataRoot() {
  ensureDir(dataRootPath())
}

export function ensureAuthDataPath() {
  ensureDir(authDataPath())
}

function readTokenFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { token?: string }
    const token = String(data?.token || '').trim()
    return token || null
  } catch {
    return null
  }
}

export function readStoredSessionToken(): string | null {
  const token = readTokenFile(sessionPath())
  if (token) return token

  if (process.platform !== 'win32') return null

  const legacyToken = readTokenFile(legacySessionPath())
  if (!legacyToken) return null

  saveStoredSessionToken(legacyToken)
  return legacyToken
}

export function saveStoredSessionToken(token: string) {
  ensureAuthDataPath()
  fs.writeFileSync(sessionPath(), JSON.stringify({ token }, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.chmodSync(sessionPath(), 0o600)
  } catch {
  }

  if (process.platform === 'win32' && fs.existsSync(legacySessionPath())) {
    try {
      fs.unlinkSync(legacySessionPath())
    } catch {
    }
  }
}

export function clearStoredSessionToken() {
  for (const filePath of [sessionPath(), process.platform === 'win32' ? legacySessionPath() : null]) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch {
      }
    }
  }
}
