import { app, ipcMain } from 'electron'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { ADMINTOOL_URL } from '../const'

export interface ILauncherInfo {
  ok: boolean
  exists?: boolean
  name?: string
  size?: number
  minimumVersion?: string
  currentVersion: string
  updateRequired: boolean
  updatedAt?: string | null
}

function compareVersions(current: string, required: string): number {
  const left = String(current || '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = String(required || '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const a = left[i] || 0
    const b = right[i] || 0
    if (a > b) return 1
    if (a < b) return -1
  }

  return 0
}

function requestLauncherInfo(): Promise<any> {
  const url = new URL('/api/launcher/info', ADMINTOOL_URL)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': `StormFrontLauncher/${app.getVersion()}`
      }
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        try {
          resolve(text ? JSON.parse(text) : {})
        } catch {
          resolve({})
        }
      })
    })

    request.setTimeout(10000, () => request.destroy(new Error('request_timeout')))
    request.on('error', reject)
    request.end()
  })
}

export function registerLauncherInfoHandlers() {
  ipcMain.handle('launcher:info', async (): Promise<ILauncherInfo> => {
    const currentVersion = app.getVersion()

    try {
      const data = await requestLauncherInfo()
      const minimumVersion = String(data?.minimumVersion || '').trim()
      const updateRequired = Boolean(minimumVersion && compareVersions(currentVersion, minimumVersion) < 0)

      return {
        ok: Boolean(data?.ok),
        exists: Boolean(data?.exists),
        name: data?.name ? String(data.name) : undefined,
        size: Number(data?.size || 0),
        minimumVersion,
        currentVersion,
        updateRequired,
        updatedAt: data?.updatedAt || null
      }
    } catch {
      return {
        ok: false,
        currentVersion,
        updateRequired: false
      }
    }
  })
}
