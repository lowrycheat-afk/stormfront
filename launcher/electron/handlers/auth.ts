import { BrowserWindow, ipcMain, shell } from 'electron'
import type { Account } from 'eml-lib'
import { createHash } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { ADMINTOOL_URL } from '../const'
import { clearStoredSessionToken, readStoredSessionToken, saveStoredSessionToken } from '../paths'

const SITE_ASSET_ORIGIN = process.env.LASTFRONT_SITE_ASSET_ORIGIN
  || process.env.LASTFRONT_AUTH_FALLBACK_ORIGIN
  || ADMINTOOL_URL

export interface ISiteUser {
  id: number
  username: string | null
  displayName: string
  email: string | null
  avatar: string | null
  role: string
}

export interface ILauncherAccount extends Account {
  siteUser?: ISiteUser
  sessionToken?: string
}

type IAuthFailure = {
  success: false
  error: string
  code?: string
  ticket?: string
}

export type IAuthResponse = { success: true; account: ILauncherAccount } | IAuthFailure

function absoluteSiteUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  try {
    return new URL(raw, `${SITE_ASSET_ORIGIN}/`).toString()
  } catch {
    return null
  }
}

function normalizeSiteUser(user: any): ISiteUser {
  return {
    id: Number(user?.id || 0),
    username: user?.username ? String(user.username) : null,
    displayName: String(user?.displayName || user?.username || `user${user?.id || 0}`),
    email: user?.email ? String(user.email) : null,
    avatar: absoluteSiteUrl(user?.avatar),
    role: String(user?.role || 'user')
  }
}

async function normalizeSiteUserWithDefaultAvatar(user: any, token?: string): Promise<ISiteUser> {
  const normalized = normalizeSiteUser(user)
  if (normalized.avatar) return normalized

  try {
    const { response, data } = await siteRequest('/api/site-settings', { method: 'GET' }, token)
    if (response.ok) normalized.avatar = absoluteSiteUrl(data?.avatarUrl)
  } catch {
    // The renderer still has a Minecraft avatar fallback if site assets are unavailable.
  }

  return normalized
}

function offlineUuidForName(name: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hash = bytes.toString('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

function toAccount(user: ISiteUser, token: string): ILauncherAccount {
  const username = user.username || user.displayName

  return {
    name: username,
    uuid: offlineUuidForName(username),
    accessToken: token,
    clientToken: '',
    meta: { type: 'crack', online: false } as Account['meta'],
    siteUser: user,
    sessionToken: token
  } as ILauncherAccount
}

function headersToRecord(value: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(value || {})
  const result: Record<string, string> = {}
  headers.forEach((headerValue, key) => {
    result[key] = headerValue
  })
  return result
}

function requestBodyToBuffer(body: BodyInit | null | undefined): Buffer | null {
  if (!body) return null
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  return Buffer.from(String(body))
}

const AUTH_FALLBACK_ORIGIN = process.env.LASTFRONT_AUTH_FALLBACK_ORIGIN || 'https://ru.lastfront.ru'

async function siteRequestAt(url: URL, options: RequestInit = {}, token?: string, redirectsLeft = 5) {
  const trustedOrigins = new Set([
    new URL(ADMINTOOL_URL).origin,
    new URL(AUTH_FALLBACK_ORIGIN).origin,
    'https://lastfront.ru'
  ])
  if (!trustedOrigins.has(url.origin)) throw new Error('untrusted_redirect')
  const headers = headersToRecord(options.headers)
  headers.accept = headers.accept || 'application/json'

  if (token) {
    headers['x-lastfront-session'] = token
  }

  const body = requestBodyToBuffer(options.body)
  if (body && !headers['content-length']) {
    headers['content-length'] = String(body.length)
  }

  return await new Promise<{ response: { ok: boolean; status: number }; data: any }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      method: options.method || 'GET',
      headers
    }, (response) => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error('too_many_redirects'))
          return
        }
        const nextUrl = new URL(location, url)
        if (!trustedOrigins.has(nextUrl.origin)) {
          reject(new Error('untrusted_redirect'))
          return
        }
        siteRequestAt(nextUrl, options, token, redirectsLeft - 1).then(resolve).catch(reject)
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('aborted', () => reject(new Error('response_aborted')))
      response.on('error', reject)
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let data: any = { error: 'request_failed' }
        try {
          data = text ? JSON.parse(text) : {}
        } catch {
          data = { error: 'request_failed' }
        }
        resolve({
          response: { ok: status >= 200 && status < 300, status },
          data
        })
      })
    })

    request.setTimeout(15000, () => {
      request.destroy(new Error('request_timeout'))
    })
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

async function siteRequest(pathname: string, options: RequestInit = {}, token?: string) {
  const primaryUrl = new URL(pathname, ADMINTOOL_URL)
  try {
    const result = await siteRequestAt(primaryUrl, options, token)
    const shouldRetry = result.response.status === 403
      || result.response.status === 408
      || result.response.status === 429
      || result.response.status >= 500
    if (!shouldRetry) return result
  } catch {
    // The Russian fallback below bypasses providers that cannot reach Cloudflare.
  }

  const fallbackUrl = new URL(`${primaryUrl.pathname}${primaryUrl.search}`, AUTH_FALLBACK_ORIGIN)
  return siteRequestAt(fallbackUrl, options, token)
}

async function accountFromCallbackPayload(payload: Record<string, string>): Promise<IAuthResponse | null> {
  const token = String(payload.session || payload.token || payload.accessToken || '').trim()
  if (!token) return null

  const username = String(payload.username || payload.name || payload.displayName || '').trim()
  if (!username) {
    return { success: false, error: 'invalid_response', code: 'invalid_response' }
  }

  const user = {
    id: payload.id || payload.userId || 0,
    username,
    displayName: payload.displayName || username,
    email: payload.email || '',
    avatar: payload.avatar || '',
    role: payload.role || 'user'
  }

  saveStoredSessionToken(token)
  return { success: true, account: toAccount(await normalizeSiteUserWithDefaultAvatar(user, token), token) }
}

async function fetchSessionAccount(token: string): Promise<IAuthResponse> {
  try {
    const { response, data } = await siteRequest('/api/auth/me', { method: 'GET' }, token)
    if (!response.ok || !data?.user) {
      clearStoredSessionToken()
      return { success: false, error: data?.error || 'invalid_session', code: data?.error || 'invalid_session' }
    }

    const refreshedToken = String(data.session || token)
    saveStoredSessionToken(refreshedToken)
    return { success: true, account: toAccount(await normalizeSiteUserWithDefaultAvatar(data.user, refreshedToken), refreshedToken) }
  } catch (err: any) {
    return { success: false, error: err?.message || 'request_failed', code: 'request_failed' }
  }
}

async function exchangeLauncherCode(code: string): Promise<IAuthResponse> {
  try {
    const { response, data } = await siteRequest('/api/auth/launcher/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })

    if (!response.ok || !data?.session || !data?.user) {
      return { success: false, error: data?.error || 'invalid_response', code: data?.error || 'invalid_response' }
    }

    const token = String(data.session)
    saveStoredSessionToken(token)
    return { success: true, account: toAccount(await normalizeSiteUserWithDefaultAvatar(data.user, token), token) }
  } catch (err: any) {
    return { success: false, error: err?.message || 'request_failed', code: 'request_failed' }
  }
}

async function passwordLogin(login: string, password: string): Promise<IAuthResponse> {
  try {
    const { response, data } = await siteRequest('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    })

    if (!response.ok) {
      return { success: false, error: data?.error || 'request_failed', code: data?.error || 'request_failed' }
    }

    if (data?.twoFactorRequired && data?.ticket) {
      return { success: false, error: 'two_factor_required', code: 'two_factor_required', ticket: String(data.ticket) }
    }

    if (!data?.session || !data?.user) {
      return { success: false, error: 'invalid_response', code: 'invalid_response' }
    }

    const token = String(data.session)
    saveStoredSessionToken(token)
    return { success: true, account: toAccount(await normalizeSiteUserWithDefaultAvatar(data.user, token), token) }
  } catch (err: any) {
    return { success: false, error: err?.message || 'request_failed', code: 'request_failed' }
  }
}

async function twoFactorLogin(ticket: string, code: string): Promise<IAuthResponse> {
  try {
    const { response, data } = await siteRequest('/api/auth/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, code })
    })

    if (!response.ok || !data?.session || !data?.user) {
      return { success: false, error: data?.error || 'request_failed', code: data?.error || 'request_failed' }
    }

    const token = String(data.session)
    saveStoredSessionToken(token)
    return { success: true, account: toAccount(await normalizeSiteUserWithDefaultAvatar(data.user, token), token) }
  } catch (err: any) {
    return { success: false, error: err?.message || 'request_failed', code: 'request_failed' }
  }
}

function siteBrowserLogin(_mainWindow: BrowserWindow): Promise<IAuthResponse> {
  return new Promise((resolve) => {
    let finished = false
    const settle = (result: IAuthResponse) => {
      if (finished) return
      finished = true
      clearTimeout(timeoutId)
      void new Promise((done) => callbackServer.close(() => done(null)))
      resolve(result)
    }

    const callbackServer = createServer(async (req, res) => {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
      if (requestUrl.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const callbackPayload = Object.fromEntries(requestUrl.searchParams) as Record<string, string>
      if (callbackPayload.error) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Authorization failed')
        settle({ success: false, error: callbackPayload.error, code: callbackPayload.error })
        return
      }

      const directAccount = await accountFromCallbackPayload(callbackPayload)
      if (directAccount) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackSuccessHtml())
        settle(directAccount)
        return
      }

      const launcherCode = String(callbackPayload.code || '').trim()
      if (!launcherCode) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Missing authorization code')
        settle({ success: false, error: 'missing_launcher_code', code: 'missing_launcher_code' })
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(callbackSuccessHtml())
      void exchangeLauncherCode(launcherCode).then(settle)
    })

    const timeoutId = setTimeout(() => {
      settle({ success: false, error: 'login_cancelled', code: 'login_cancelled' })
    }, 5 * 60 * 1000)

    callbackServer.listen(0, '127.0.0.1', async () => {
      const address = callbackServer.address()
      if (!address || typeof address === 'string') {
        settle({ success: false, error: 'callback_server_failed', code: 'callback_server_failed' })
        return
      }

      const callbackUrl = `http://127.0.0.1:${address.port}/callback`
      const signInUrl = `${ADMINTOOL_URL}/signin?launcher=1&callback=${encodeURIComponent(callbackUrl)}`

      try {
        await shell.openExternal(signInUrl)
      } catch (err: any) {
        settle({ success: false, error: err?.message || 'open_browser_failed', code: 'open_browser_failed' })
      }
    })
  })
}

function callbackSuccessHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StormFront</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #121212;
        color: #f5f5f5;
        font-family: "Segoe UI", Arial, sans-serif;
      }

      .box {
        width: min(360px, calc(100vw - 32px));
        padding: 24px;
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(39, 42, 44, 0.96) 0%, rgba(26, 28, 29, 0.98) 100%);
        border: 1px solid rgba(90, 138, 111, 0.16);
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.58);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 20px;
        color: #c9c5ba;
      }

      p {
        margin: 0;
        color: #8f8a80;
        line-height: 1.45;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>StormFront</h1>
      <p>Authorization completed. This tab will close automatically.</p>
    </div>
    <script>
      window.onload = () => {
        setTimeout(() => {
          window.open('', '_self')
          window.close()
        }, 150)
      }
    </script>
  </body>
</html>`
}

export function registerAuthHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('auth:login', async (_event, payload: { login: string; password: string }) => {
    return await passwordLogin(String(payload?.login || ''), String(payload?.password || ''))
  })

  ipcMain.handle('auth:complete_2fa', async (_event, payload: { ticket: string; code: string }) => {
    return await twoFactorLogin(String(payload?.ticket || ''), String(payload?.code || ''))
  })

  ipcMain.handle('auth:login_via_site', async () => {
    return await siteBrowserLogin(mainWindow)
  })

  ipcMain.handle('auth:refresh', async () => {
    const token = readStoredSessionToken()
    if (!token) {
      return { success: false, error: 'not_authenticated', code: 'not_authenticated' } as IAuthFailure
    }

    return await fetchSessionAccount(token)
  })

  ipcMain.handle('auth:offline_login', async (_event, payload: { nickname: string }) => {
    const nickname = String(payload?.nickname || '').trim().slice(0, 16)
    if (!nickname) {
      return { success: false, error: 'missing_nickname', code: 'missing_nickname' } as IAuthFailure
    }

    const token = `offline-${createHash('md5').update(nickname.toLowerCase()).digest('hex')}`
    const account = toAccount(
      { id: 0, username: nickname, displayName: nickname, email: null, avatar: null, role: 'user' },
      token
    )
    return { success: true, account }
  })

  ipcMain.handle('auth:logout', async () => {
    clearStoredSessionToken()
    return { success: true }
  })
}
