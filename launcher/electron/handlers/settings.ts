import { ipcMain, app, screen, dialog } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { ensureDataRoot, settingsPath } from '../paths'

export interface ISystemInfo {
  totalMem: number // in GB
  resolution: {
    width: number
    height: number
  }
  version: string
}

export interface IGameSettings {
  java: string
  downloadRegion: 'germany' | 'russia'
  memory: {
    min: string
    max: string
  }
  resolution: {
    width: number
    height: number
    fullscreen: boolean
  },
  launcherAction: 'close' | 'keep' | 'hide'
  nickname?: string
}

export const DEFAULT_SETTINGS: IGameSettings = {
  java: 'bundled',
  downloadRegion: 'germany',
  memory: {
    min: '1G',
    max: '4G'
  },
  resolution: {
    width: 1280,
    height: 720,
    fullscreen: false
  },
  launcherAction: 'close',
  nickname: 'Player'
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async () => {
    try {
      ensureDataRoot()
      const filePath = settingsPath()
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2))
        return DEFAULT_SETTINGS
      }
      const data = fs.readFileSync(filePath, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    } catch (err) {
      console.error('Error reading settings:', err)
      return DEFAULT_SETTINGS
    }
  })

  ipcMain.handle('settings:set', async (_event, newSettings: IGameSettings) => {
    try {
      ensureDataRoot()
      fs.writeFileSync(settingsPath(), JSON.stringify(newSettings, null, 2))
      return true
    } catch (err) {
      console.error('Error writing settings:', err)
      return false
    }
  })

  ipcMain.handle('system:info', async () => {
    const totalMemBytes = os.totalmem()
    const totalMemGB = Math.round(totalMemBytes / 1024 / 1024 / 1024)

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    return {
      totalMem: totalMemGB,
      resolution: { width, height },
      version: app.getVersion()
    }
  })

  ipcMain.handle('settings:pick_java', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Java Executable', extensions: ['exe', 'bin', ''] }]
    })
    return result.filePaths[0] ?? null
  })
}

