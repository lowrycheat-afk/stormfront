import { ipcMain } from 'electron'

export function registerBackgroundHandlers() {
  ipcMain.handle('background:get', async () => {
    // Background check disabled
    return null
  })
}
