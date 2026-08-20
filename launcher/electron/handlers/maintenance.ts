import { ipcMain } from 'electron'

export function registerMaintenanceHandlers() {
  ipcMain.handle('maintenance:get', async () => {
    // Maintenance check disabled
    return null
  })
}
