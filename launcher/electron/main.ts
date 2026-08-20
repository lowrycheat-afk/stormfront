import { app, BrowserWindow, Menu, nativeTheme, shell, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAuthHandlers } from './handlers/auth'
import { registerLauncherHandlers } from './handlers/launcher'
import { registerSettingsHandlers } from './handlers/settings'
import { registerServerHandlers } from './handlers/server'
import { registerNewsHandlers } from './handlers/news'
import { registerBackgroundHandlers } from './handlers/background'
import { registerMaintenanceHandlers } from './handlers/maintenance'
import { registerBootstrapHandlers } from './handlers/bootstraps'
import { registerLauncherInfoHandlers } from './handlers/launcher-info'

const APP_TITLE = 'EML Template'
const BG_COLOR = '#121212'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null

if (process.env.VITE_DEV_SERVER_URL) {
  app.setName(APP_TITLE)
}

function createWindow() {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 870,
    height: 552,
    minWidth: 870,
    minHeight: 552,
    resizable: false,
    title: APP_TITLE,
    autoHideMenuBar: true,
    backgroundColor: BG_COLOR,
    show: false,
    frame: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
      // Performance optimizations
      offscreen: false,
      enableWebSQL: false,
      spellcheck: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // mainWindow.removeMenu()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    
    // Optimize rendering after window is shown
    if (mainWindow) {
      mainWindow.webContents.setFrameRate(60)
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function configureAppMenu() {
  app.setAboutPanelOptions({
    applicationName: APP_TITLE,
    applicationVersion: app.getVersion(),
    version: 'Build 2025.1',
    copyright: 'Copyright © 2025 EML',
    credits: 'Developed with EML Lib & Electron',
    iconPath: path.join(__dirname, '../build/icon.png')
  })

  const template: any[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),

    {
      label: 'File',
      submenu: [{ role: 'close' }]
    },

    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  configureAppMenu()

  createWindow()

  if (mainWindow) {
    // Window controls
    ipcMain.on('window:minimize', () => {
      mainWindow?.minimize()
    })
    
    ipcMain.on('window:close', () => {
      mainWindow?.close()
    })

    registerAuthHandlers(mainWindow)
    registerServerHandlers()
    registerNewsHandlers()
    registerBackgroundHandlers()
    registerMaintenanceHandlers()
    registerLauncherInfoHandlers()
    registerBootstrapHandlers(mainWindow)
    registerLauncherHandlers(mainWindow)
    registerSettingsHandlers()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})
