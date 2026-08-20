import './style.css'

const FALLBACK_BACKGROUND = '/src/static/images/bg.jpg'

const DATE_OPTIONS = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}

let currentAccount = null
let currentSettings = null

function getCurrentAccount() {
  return currentAccount
}

function setAccount(account) {
  if ('access_token' in account) {
    currentAccount = {
      name: account.name,
      uuid: account.uuid,
      accessToken: account.access_token,
      clientToken: '',
      meta: account.meta
    }
  } else {
    currentAccount = account
  }
  updateUserUI()
}

function clearAccount() {
  currentAccount = null
  const nameEl = document.getElementById('user-name')
  const roleEl = document.getElementById('user-role')
  const avatarEl = document.getElementById('user-avatar')

  if (nameEl) nameEl.textContent = 'Not signed in'
  if (roleEl) roleEl.textContent = ''
  if (avatarEl) avatarEl.src = 'https://minotar.net/helm/Steve/100.png'
}

function updateUserUI() {
  if (!currentAccount) return
  console.log('Updating UI for user:', currentAccount.name)

  const nameEl = document.getElementById('user-name')
  const roleEl = document.getElementById('user-role')
  const avatarEl = document.getElementById('user-avatar')

  if (nameEl) nameEl.textContent = currentAccount.name
  if (roleEl) roleEl.textContent = currentAccount.siteUser?.role ? `Role: ${currentAccount.siteUser.role}` : ''

  if (avatarEl) {
    const fallbackUrl = `https://minotar.net/helm/${encodeURIComponent(currentAccount.uuid ?? currentAccount.name)}/100.png`
    const siteAvatar = currentAccount.siteUser?.avatar

    avatarEl.onerror = siteAvatar
      ? () => {
          avatarEl.onerror = null
          avatarEl.src = fallbackUrl
        }
      : null
    avatarEl.src = siteAvatar || fallbackUrl
  }
}

function showView(viewName) {
  const view = document.querySelector(`.view[data-view="${viewName}"]`)
  if (!view) {
    console.error(`View ${viewName} not found`)
    return
  }

  if (!view.classList.contains('overlay')) {
    document.querySelectorAll('.view').forEach((item) => {
      if (!item.classList.contains('overlay')) {
        item.classList.remove('active')
      }
    })
  }
  view.classList.add('active')
}

function hideView(viewName) {
  document.querySelector(`.view[data-view="${viewName}"]`)?.classList.remove('active')
}

function showSplashView(viewName) {
  setTimeout(() => {
    document.querySelector('div#view-loading')?.classList.add('loaded')
  }, 400)

  setTimeout(() => {
    document.querySelector(`div#view-${viewName}`)?.classList.add('loaded')
  }, 200)
}

const authApi = {
  login: async (payload) => await window.api.auth.login(payload),
  completeTwoFactor: async (payload) => await window.api.auth.completeTwoFactor(payload),
  loginViaSite: async () => await window.api.auth.loginViaSite(),
  offlineLogin: async (payload) => await window.api.auth.offlineLogin(payload),
  logout: async () => await window.api.auth.logout(),
  refresh: async () => await window.api.auth.refresh()
}

const backgroundApi = {
  get: async () => await window.api.background.get()
}

const maintenanceApi = {
  get: async () => await window.api.maintenance.get()
}

const launcherInfoApi = {
  get: async () => await window.api.launcherInfo.get()
}

const bootstrapsApi = {
  check: async () => await window.api.bootstraps.check(),
  download: async () => await window.api.bootstraps.download(),
  install: async () => await window.api.bootstraps.install(),
  downloadProgress: (callback) => window.api.bootstraps.downloadProgress(callback),
  downloadEnd: (callback) => window.api.bootstraps.downloadEnd(callback),
  error: (callback) => window.api.bootstraps.error(callback)
}

const gameApi = {
  launch: async (payload) => await window.api.game.launch(payload),
  launchComputeDownload: (callback) => window.api.game.launchComputeDownload(callback),
  launchDownload: (callback) => window.api.game.launchDownload(callback),
  downloadProgress: (callback) => window.api.game.downloadProgress(callback),
  downloadError: (callback) => window.api.game.downloadError(callback),
  downloadEnd: (callback) => window.api.game.downloadEnd(callback),
  assetsProgress: (callback) => window.api.game.assetsProgress(callback),
  modsProgress: (callback) => window.api.game.modsProgress(callback),
  resourcepacksProgress: (callback) => window.api.game.resourcepacksProgress(callback),
  launchInstallLoader: (callback) => window.api.game.launchInstallLoader(callback),
  launchExtractNatives: (callback) => window.api.game.launchExtractNatives(callback),
  extractProgress: (callback) => window.api.game.extractProgress(callback),
  extractEnd: (callback) => window.api.game.extractEnd(callback),
  launchCopyAssets: (callback) => window.api.game.launchCopyAssets(callback),
  copyProgress: (callback) => window.api.game.copyProgress(callback),
  copyEnd: (callback) => window.api.game.copyEnd(callback),
  launchPatchLoader: (callback) => window.api.game.launchPatchLoader(callback),
  patchProgress: (callback) => window.api.game.patchProgress(callback),
  patchError: (callback) => window.api.game.patchError(callback),
  patchEnd: (callback) => window.api.game.patchEnd(callback),
  launchCheckJava: (callback) => window.api.game.launchCheckJava(callback),
  javaInfo: (callback) => window.api.game.javaInfo(callback),
  launchClean: (callback) => window.api.game.launchClean(callback),
  cleanProgress: (callback) => window.api.game.cleanProgress(callback),
  cleanEnd: (callback) => window.api.game.cleanEnd(callback),
  launchLaunch: (callback) => window.api.game.launchLaunch(callback),
  launched: (callback) => window.api.game.launched(callback),
  accountInvalidated: (callback) => window.api.game.accountInvalidated(callback),
  launchData: (callback) => window.api.game.launchData(callback),
  launchClose: (callback) => window.api.game.launchClose(callback),
  launchDebug: (callback) => window.api.game.launchDebug(callback),
  patchDebug: (callback) => window.api.game.patchDebug(callback)
}

const settingsApi = {
  get: () => window.api.settings.get(),
  set: (settings) => window.api.settings.set(settings),
  pickJava: () => window.api.settings.pickJava()
}

const systemApi = {
  getInfo: () => window.api.system.getInfo()
}

const windowApi = {
  minimize: () => window.api.window.minimize(),
  close: () => window.api.window.close()
}

class Dialog {
  overlay
  messageEl
  titleEl
  buttonsEl

  constructor() {
    this.overlay = document.getElementById('custom-dialog')
    this.messageEl = document.getElementById('dialog-message')
    this.titleEl = document.getElementById('dialog-title')
    this.buttonsEl = document.getElementById('dialog-buttons')
  }

  async show(message, buttons, title) {
    return new Promise((resolve) => {
      this.messageEl.innerText = message
      this.buttonsEl.innerHTML = ''

      if (title) {
        this.titleEl.innerText = title
        this.titleEl.classList.remove('hidden')
      } else {
        this.titleEl.classList.add('hidden')
      }

      ;(buttons ?? [
        { text: 'Cancel', type: 'cancel' },
        { text: 'OK', type: 'ok' }
      ]).forEach((button) => {
        const buttonEl = document.createElement('button')
        buttonEl.innerText = button.text
        buttonEl.className = `btn btn-${button.type === 'ok' ? 'secondary' : button.type === 'danger' ? 'danger' : 'secondary'}`

        buttonEl.onclick = async () => {
          this.close()
          if (button.action) {
            const result = await button.action()
            resolve(result !== undefined ? result : true)
          } else {
            switch (button.type) {
              case 'cancel':
                resolve(false)
                break
              case 'ok':
              case 'danger':
                resolve(true)
                break
              case 'other':
                console.warn("The 'other' type button requires an action!")
                resolve(null)
                break
            }
          }
        }

        this.buttonsEl.appendChild(buttonEl)
      })

      this.overlay.classList.remove('hidden')
    })
  }

  close() {
    this.overlay.classList.add('hidden')
  }
}

const dialog = new Dialog()

function setupLogin() {
  const form = document.getElementById('login-form')
  const loginInput = document.getElementById('login-input')
  const passwordInput = document.getElementById('password-input')
  const twoFactorModal = document.getElementById('two-factor-modal')
  const twoFactorForm = document.getElementById('two-factor-form')
  const twoFactorInput = document.getElementById('two-factor-input')
  const cancelTwoFactorBtn = document.getElementById('btn-cancel-2fa')
  const submitTwoFactorBtn = document.getElementById('btn-submit-2fa')
  const loginBtn = document.getElementById('btn-login')
  const loginSiteBtn = document.getElementById('btn-login-site')
  const loginOfflineBtn = document.getElementById('btn-login-offline')
  const loginSubtitle = document.getElementById('login-subtitle')

  if (!form || !loginInput || !passwordInput || !loginBtn || !loginSiteBtn || !loginOfflineBtn) return

  let pendingTicket = ''

  const resetLogin = () => {
    pendingTicket = ''
    if (twoFactorModal) twoFactorModal.classList.add('hidden')
    if (twoFactorInput) twoFactorInput.value = ''
    loginBtn.textContent = 'Sign In'
    if (loginSubtitle) loginSubtitle.textContent = 'Use your StormFront account to continue.'
  }

  const setLoading = (loading, label) => {
    loginBtn.disabled = loading
    loginSiteBtn.disabled = loading
    loginOfflineBtn.disabled = loading
    loginBtn.innerHTML = loading
      ? `<i class="fa-solid fa-circle-notch fa-spin"></i> ${label}`
      : pendingTicket
        ? 'Confirm Code'
        : 'Sign In'
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const login = loginInput.value.trim()
    const password = passwordInput.value

    if (!login || !password) {
      await dialog.show('Enter your login and password.', [{ text: 'OK', type: 'ok' }])
      return
    }

    try {
      setLoading(true, 'Signing in...')
      const result = await authApi.login({ login, password })

      if (result.success) {
        resetLogin()
        setAccount(result.account)
        showView('home')
        return
      }

      if (result.code === 'two_factor_required' && result.ticket) {
        pendingTicket = result.ticket
        if (twoFactorModal) twoFactorModal.classList.remove('hidden')
        twoFactorInput?.focus()
        return
      }

      await dialog.show(loginErrorText(result.code || result.error), [{ text: 'OK', type: 'ok' }])
    } catch (error) {
      console.error(error)
      await dialog.show('An error occurred during login.', [{ text: 'OK', type: 'ok' }])
    } finally {
      setLoading(false, '')
    }
  })

  twoFactorForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!pendingTicket) return

    try {
      if (submitTwoFactorBtn) submitTwoFactorBtn.disabled = true
      if (cancelTwoFactorBtn) cancelTwoFactorBtn.disabled = true

      const code = twoFactorInput?.value.trim() || ''
      const result = await authApi.completeTwoFactor({ ticket: pendingTicket, code })

      if (result.success) {
        resetLogin()
        setAccount(result.account)
        showView('home')
        return
      }

      await dialog.show(loginErrorText(result.code || result.error), [{ text: 'OK', type: 'ok' }])
      if (twoFactorInput) {
        twoFactorInput.value = ''
        twoFactorInput.focus()
      }
    } catch (error) {
      console.error(error)
      await dialog.show('An error occurred during two-factor verification.', [{ text: 'OK', type: 'ok' }])
    } finally {
      if (submitTwoFactorBtn) submitTwoFactorBtn.disabled = false
      if (cancelTwoFactorBtn) cancelTwoFactorBtn.disabled = false
    }
  })

  cancelTwoFactorBtn?.addEventListener('click', () => {
    resetLogin()
  })

  loginSiteBtn.addEventListener('click', async () => {
    try {
      setLoading(true, 'Opening site...')
      const result = await authApi.loginViaSite()

      if (result.success) {
        resetLogin()
        setAccount(result.account)
        showView('home')
        return
      }

      if (result.code !== 'login_cancelled') {
        await dialog.show(loginErrorText(result.code || result.error), [{ text: 'OK', type: 'ok' }])
      }
    } catch (error) {
      console.error(error)
      await dialog.show('Could not complete sign in through the site.', [{ text: 'OK', type: 'ok' }])
    } finally {
      setLoading(false, '')
    }
  })

  loginOfflineBtn.addEventListener('click', async () => {
    const nickname = (loginInput.value.trim() || 'lowrycheat-afk').slice(0, 16)
    if (!nickname) {
      await dialog.show('Enter your nickname first.', [{ text: 'OK', type: 'ok' }])
      return
    }

    try {
      setLoading(true, 'Signing in offline...')
      const result = await authApi.offlineLogin({ nickname })
      if (result.success) {
        resetLogin()
        setAccount(result.account)
        showView('home')
        return
      }
      await dialog.show(loginErrorText(result.code || result.error), [{ text: 'OK', type: 'ok' }])
    } catch (error) {
      console.error(error)
      await dialog.show('Could not sign in offline.', [{ text: 'OK', type: 'ok' }])
    } finally {
      setLoading(false, '')
    }
  })
}

function loginErrorText(code) {
  switch (code) {
    case 'invalid_credentials':
      return 'Incorrect login or password.'
    case 'invalid_2fa_code':
      return 'Incorrect two-factor code.'
    case 'invalid_2fa_ticket':
      return 'The two-factor session expired. Please sign in again.'
    case 'account_banned':
      return 'This account is banned.'
    case 'request_failed':
      return 'The site is unavailable right now. Try again in a moment.'
    case 'invalid_response':
      return 'The site completed authorization but did not return launcher login data.'
    case 'invalid_launcher_code':
      return 'The site authorization code expired. Try signing in through the site again.'
    case 'missing_launcher_code':
      return 'The site did not return an authorization code.'
    case 'missing_launcher_payload':
      return 'The site did not return launcher authorization data.'
    case 'callback_server_failed':
      return 'Could not start the local authorization callback.'
    case 'open_browser_failed':
      return 'Could not open the browser for site authorization.'
    default:
      return 'Login failed.'
  }
}

function setupHome() {
  const playBtn = document.getElementById('btn-play')
  const settingsBtn = document.getElementById('btn-settings')
  const openProfileBtn = document.getElementById('btn-open-profile')
  const logoutBtn = document.getElementById('btn-logout')
  const progressFill = document.getElementById('launch-progress-fill')
  const launchText = document.getElementById('launch-text')
  const launchIcon = playBtn?.querySelector('.launch-text i')

  document.querySelectorAll('.window-btn.minimize').forEach((button) => {
    button.addEventListener('click', () => {
      windowApi.minimize()
    })
  })

  document.querySelectorAll('.window-btn.close').forEach((button) => {
    button.addEventListener('click', () => {
      windowApi.close()
    })
  })

  let totalDownloadSize = 0
  let downloadTypes = []

  const setIndeterminate = (enabled) => {
    if (!progressFill) return
    if (enabled) {
      progressFill.classList.add('indeterminate')
      progressFill.style.width = '30%'
    } else {
      progressFill.classList.remove('indeterminate')
    }
  }

  const updateProgress = (percent, label) => {
    if (progressFill) progressFill.style.width = `${percent}%`
    if (launchText) launchText.textContent = label

    if (launchIcon && playBtn?.classList.contains('loading')) {
      launchIcon.className = 'fa-solid fa-download'
    }
  }

  const resetLaunch = () => {
    playBtn?.classList.remove('loading')
    if (progressFill) {
      progressFill.style.width = '0%'
      progressFill.classList.remove('indeterminate')
    }
    if (launchText) launchText.textContent = 'Launch'
    if (launchIcon) launchIcon.className = 'fa-solid fa-play'
  }

  settingsBtn?.addEventListener('click', () => {
    showView('settings')
  })

  openProfileBtn?.addEventListener('click', () => {
    window.open('https://lastfront.ru/profile', '_blank')
  })

  logoutBtn?.addEventListener('click', async () => {
    try {
      logoutBtn.setAttribute('disabled', 'true')
      await authApi.logout()
      clearAccount()
      showView('login')
    } catch (error) {
      console.error(error)
      await dialog.show('Could not log out right now.', [{ text: 'OK', type: 'ok' }])
    } finally {
      logoutBtn.removeAttribute('disabled')
    }
  })

  playBtn?.addEventListener('click', async () => {
    if (playBtn.classList.contains('loading')) return

    playBtn.classList.add('loading')
    setIndeterminate(true)
    updateProgress(0, 'Preparing...')

    const account = getCurrentAccount()
    if (!account) {
      resetLaunch()
      return
    }

    const settings = await settingsApi.get()
    console.log(`
Ready to launch the game with the following settings:

Account: ${account.name}
RAM: ${settings.memory.min} - ${settings.memory.max}
Java: ${settings.java}
Region: ${settings.downloadRegion === 'russia' ? 'Russia' : 'Germany'}
Resolution: ${settings.resolution.width}x${settings.resolution.height}
    `)

    gameApi.launch({ account, settings })
  })

  gameApi.launchComputeDownload(() => {
    setIndeterminate(true)
    updateProgress(0, 'Preparing...')
  })

  gameApi.launchDownload((data) => {
    setIndeterminate(false)
    totalDownloadSize = data.total.size
    updateProgress(0, 'Downloading...')
  })

  gameApi.downloadProgress((data) => {
    const existing = downloadTypes.find((item) => item.type === data.type)
    if (existing) {
      downloadTypes[downloadTypes.findIndex((item) => item.type === data.type)].size = data.downloaded.size
    } else {
      downloadTypes.push({ type: data.type, size: data.downloaded.size })
    }

    const totalDownloaded = downloadTypes.reduce((sum, item) => sum + item.size, 0)
    const percent = Math.min((totalDownloaded / totalDownloadSize) * 100, 100)
    updateProgress(percent, 'Downloading...')
  })

  gameApi.launchInstallLoader(() => {
    setIndeterminate(true)
    updateProgress(0, 'Installing...')
  })

  gameApi.launchExtractNatives(() => {
    setIndeterminate(true)
    updateProgress(0, 'Extracting...')
  })

  gameApi.launchCopyAssets(() => {
    setIndeterminate(true)
    updateProgress(0, 'Extracting...')
  })

  gameApi.launchPatchLoader(() => {
    setIndeterminate(true)
    updateProgress(0, 'Finalizing...')
  })

  gameApi.launchLaunch(() => {
    setIndeterminate(true)
    updateProgress(0, 'Launching game...')
  })

  gameApi.assetsProgress((data) => {
    setIndeterminate(false)
    updateProgress(data.percent, `Downloading assets: ${data.downloaded + data.skipped}/${data.total}`)
  })

  gameApi.downloadProgress((data) => {
    setIndeterminate(false)
    const downloaded = (data.downloaded / 1024 / 1024).toFixed(1)
    const total = (data.total / 1024 / 1024).toFixed(1)
    updateProgress(data.percent, `Downloading ${data.label}: ${downloaded}/${total} MB`)
  })

  gameApi.modsProgress((data) => {
    setIndeterminate(false)
    updateProgress(data.percent, `Downloading mods: ${data.current}/${data.total}`)
  })

  gameApi.resourcepacksProgress((data) => {
    setIndeterminate(false)
    updateProgress(data.percent, `Downloading resource packs: ${data.current}/${data.total}`)
  })

  gameApi.launchData((data) => {
    if (
      data.includes('All') &&
      (data.includes('up to date') || data.includes('present'))
    ) {
      setIndeterminate(true)
      updateProgress(0, 'Starting game...')
    }

    if (data.startsWith('Launch failed:')) {
      setIndeterminate(false)
      updateProgress(0, 'Launch failed')
    }

    console.log('[Game]', data)
  })

  gameApi.launchClose(() => {
    resetLaunch()
  })

  gameApi.launched(() => {
    updateProgress(100, 'Game launched!')
    setTimeout(() => {
      resetLaunch()
    }, 2000)
  })

  gameApi.accountInvalidated((data) => {
    resetLaunch()
    clearAccount()
    showView('login')
    dialog.show(accountInvalidatedText(data.reason), [{ text: 'OK', type: 'ok' }])
  })
}

function accountInvalidatedText(reason) {
  switch (reason) {
    case 'account_banned':
      return 'This account is banned. The game was closed.'
    case 'not_authenticated':
    case 'invalid_session':
      return 'Your session is no longer valid. The game was closed.'
    default:
      return 'Account access was revoked. The game was closed.'
  }
}

async function loadSystemInfo() {
  const systemInfo = await systemApi.getInfo()
  currentSettings = await settingsApi.get()
  setupSettingsSelect()
  setupRamSlider(systemInfo.totalMem)
  applySettings()
}

function setupSettingsSelect() {
  const closeBtn = document.getElementById('btn-close-settings')
  const select = document.getElementById('download-region')
  const toggle = select?.querySelector('.custom-select-toggle')
  const menu = select?.querySelector('.custom-select-menu')
  const options = Array.from(select?.querySelectorAll('.custom-select-option') || [])

  const close = (focusToggle = false) => {
    select?.classList.remove('open')
    toggle?.setAttribute('aria-expanded', 'false')
    if (focusToggle) toggle?.focus()
  }

  const open = () => {
    select?.classList.add('open')
    toggle?.setAttribute('aria-expanded', 'true')
  }

  closeBtn?.addEventListener('click', async () => {
    close()
    await saveSettings()
    hideView('settings')
  })

  toggle?.addEventListener('click', () => {
    select?.classList.contains('open') ? close() : open()
  })

  toggle?.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    open()

    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.classList.contains('selected'))
    )
    options[selectedIndex]?.focus()
  })

  menu?.addEventListener('keydown', (event) => {
    const currentIndex = options.indexOf(document.activeElement)

    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (currentIndex + direction + options.length) % options.length
      options[nextIndex]?.focus()
    }
  })

  options.forEach((option) => {
    option.addEventListener('click', async () => {
      setRegion(option.dataset.value)
      close(true)
      await saveSettings()
    })
  })

  document.addEventListener('pointerdown', (event) => {
    if (select && !select.contains(event.target)) close()
  })
}

function setRegion(value) {
  const select = document.getElementById('download-region')
  const region = value === 'russia' ? 'russia' : 'germany'
  const valueEl = select?.querySelector('#download-region-value')
  const options = select?.querySelectorAll('.custom-select-option') || []

  if (select) select.dataset.value = region
  if (valueEl) valueEl.textContent = region === 'russia' ? 'Russia' : 'Germany'

  options.forEach((option) => {
    const selected = option.dataset.value === region
    option.classList.toggle('selected', selected)
    option.setAttribute('aria-selected', String(selected))
  })
}

function setupRamSlider(totalMemGB) {
  totalMemGB = Math.min(totalMemGB, 16)

  const minSlider = document.getElementById('ram-min')
  const maxSlider = document.getElementById('ram-max')
  const trackFill = document.getElementById('ram-track-fill')
  const minLabel = document.getElementById('ram-min-label')
  const maxLabel = document.getElementById('ram-max-label')

  if (!minSlider || !maxSlider || !trackFill) return

  minSlider.max = totalMemGB.toString()
  maxSlider.max = totalMemGB.toString()

  const minGap = 0.5

  const update = (event) => {
    let minValue = parseFloat(minSlider.value)
    let maxValue = parseFloat(maxSlider.value)

    if (maxValue - minValue < minGap) {
      if (event?.target === minSlider) {
        minSlider.value = (maxValue - minGap).toString()
        minValue = parseFloat(minSlider.value)
      } else {
        maxSlider.value = (minValue + minGap).toString()
        maxValue = parseFloat(maxSlider.value)
      }
    }

    if (minLabel) minLabel.innerText = `${minValue} GB`
    if (maxLabel) maxLabel.innerText = `${maxValue} GB`

    const range = totalMemGB - parseFloat(minSlider.min)
    const minPercent = ((minValue - parseFloat(minSlider.min)) / range) * 100
    const maxPercent = ((maxValue - parseFloat(maxSlider.min)) / range) * 100

    trackFill.style.left = `${minPercent}%`
    trackFill.style.width = `${maxPercent - minPercent}%`
  }

  minSlider.addEventListener('input', update)
  maxSlider.addEventListener('input', update)
  update()
}

function applySettings() {
  if (!currentSettings) return

  const minSlider = document.getElementById('ram-min')
  const maxSlider = document.getElementById('ram-max')

  if (minSlider) minSlider.value = currentSettings.memory.min.replace('G', '')
  if (maxSlider) maxSlider.value = currentSettings.memory.max.replace('G', '')
  setRegion(currentSettings.downloadRegion)

  minSlider.dispatchEvent(new Event('input'))
}

async function saveSettings() {
  const minSlider = document.getElementById('ram-min')
  const maxSlider = document.getElementById('ram-max')
  const region =
    document.getElementById('download-region')?.dataset.value === 'russia'
      ? 'russia'
      : 'germany'

  const newSettings = {
    ...currentSettings,
    downloadRegion: region,
    memory: { min: `${minSlider.value}G`, max: `${maxSlider.value}G` },
    launcherAction: 'close'
  }

  await settingsApi.set(newSettings)
  currentSettings = newSettings
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.src = src
    image.onload = () => resolve()
    image.onerror = () => resolve()
  })
}

async function init() {
  console.log('Initializing Launcher...')

  const backgroundEl = document.querySelector('.app-background')
  const maintenanceDatesEl = document.getElementById('maintenance-dates')
  const maintenanceReasonEl = document.getElementById('maintenance-reason')
  const updateProgressBar = document.getElementById('update-progress-bar')
  const updateProgressLabel = document.getElementById('update-progress-label')
  const updateProgressPercent = document.getElementById('update-progress-percent')
  const updateTextEl = document.getElementById('update-text')

  const setUpdateIndeterminate = (enabled) => {
    if (!updateProgressBar || !updateProgressPercent) return
    if (enabled) {
      updateProgressBar.classList.add('indeterminate')
      updateProgressPercent.style.display = 'none'
    } else {
      updateProgressBar.classList.remove('indeterminate')
      updateProgressPercent.style.display = 'block'
    }
  }

  const bootstraps = await bootstrapsApi.check()
  const launcherInfo = await launcherInfoApi.get()
  const background = await backgroundApi.get()
  const maintenance = await maintenanceApi.get()

  const backgroundUrl = background?.file?.url ?? FALLBACK_BACKGROUND

  if (launcherInfo.updateRequired) {
    setUpdateIndeterminate(false)
    updateProgressBar.style.width = '0%'
    updateProgressLabel.innerText = 'Update required'
    updateProgressPercent.innerText = ''
    if (updateTextEl) {
      updateTextEl.innerText = `Launcher ${launcherInfo.currentVersion} is no longer supported. Required version: ${launcherInfo.minimumVersion}. Please install the latest launcher from the site.`
    }
    showSplashView('update')
    return
  }

  if (bootstraps.updateAvailable) {
    setUpdateIndeterminate(false)
    updateProgressBar.style.width = '0%'
    updateProgressLabel.innerText = 'Preparing update...'
    updateProgressPercent.innerText = '0%'
    showSplashView('update')

    await new Promise((resolve) => setTimeout(resolve, 500))

    bootstrapsApi.downloadProgress((data) => {
      updateProgressLabel.innerText = 'Downloading update...'
      const percent = ((data.downloaded.size / data.total.amount) * 100).toFixed(2)
      updateProgressPercent.innerText = `${percent}%`
      updateProgressBar.style.width = `${percent}%`
    })

    bootstrapsApi.downloadEnd(async () => {
      setUpdateIndeterminate(true)
      updateProgressLabel.innerText = 'Installing...'
      await bootstrapsApi.install()
    })

    bootstrapsApi.error((error) => {
      console.error('Error while downloading bootstraps:', error)
    })

    await bootstrapsApi.download()
    console.log('Update installed, restarting launcher...')

    setTimeout(() => {
      window.location.reload()
    }, 1000)
    return
  }

  if (maintenance) {
    const start = new Date(maintenance.startTime)
    const end = new Date(maintenance.endTime)

    maintenanceDatesEl.innerText = `From ${start.toLocaleString([], DATE_OPTIONS)} to ${end.toLocaleString([], DATE_OPTIONS)}`
    maintenanceReasonEl.innerText = maintenance.message ?? 'Please come back later.'
    showSplashView('maintenance')
    return
  }

  try {
    await loadImage(backgroundUrl)
    if (backgroundEl) backgroundEl.style.backgroundImage = `url('${backgroundUrl}')`

    const refreshResult = await authApi.refresh()
    if (refreshResult.success) {
      setAccount(refreshResult.account)
      showView('home')
      return
    }

    const offlineResult = await authApi.offlineLogin({ nickname: 'lowrycheat-afk' })
    if (offlineResult.success) {
      setAccount(offlineResult.account)
      showView('home')
      return
    }

    showView('login')
  } catch (error) {
    console.error('Error while itializing launcher:', error)
    if (backgroundEl) backgroundEl.style.backgroundImage = `url('${FALLBACK_BACKGROUND}')`
    showView('login')
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 200))
    document.querySelector('div#view-loading')?.classList.add('loaded')
    await new Promise((resolve) => setTimeout(resolve, 100))
    document.body.classList.add('loaded')
  }
}

setupLogin()
setupHome()
loadSystemInfo()
init()