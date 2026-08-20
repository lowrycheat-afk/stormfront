import { contextBridge, ipcRenderer } from 'electron'
import type { IGameSettings, ISystemInfo } from './handlers/settings'
import type { IAuthResponse } from './handlers/auth'
import type {
  Account,
  BootstrapsEvents,
  CleanerEvents,
  DownloaderEvents,
  FilesManagerEvents,
  IBackground,
  IBootstraps,
  IMaintenance,
  INews,
  JavaEvents,
  LauncherEvents,
  PatcherEvents
} from 'eml-lib'
import type { ILauncherInfo } from './handlers/launcher-info'
import type { ServerStatus } from 'eml-lib/types/status'

contextBridge.exposeInMainWorld('api', {
  receive: (channel: string, callback: (data: any) => void) => {
    ipcRenderer.on(channel, (_event, data) => callback(data))
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close')
  },
  auth: {
    login: (payload: { login: string; password: string }): Promise<IAuthResponse> => ipcRenderer.invoke('auth:login', payload),
    completeTwoFactor: (payload: { ticket: string; code: string }): Promise<IAuthResponse> => ipcRenderer.invoke('auth:complete_2fa', payload),
    loginViaSite: (): Promise<IAuthResponse> => ipcRenderer.invoke('auth:login_via_site'),
    refresh: (): Promise<IAuthResponse> => ipcRenderer.invoke('auth:refresh'),
    offlineLogin: (payload: { nickname: string }): Promise<IAuthResponse> => ipcRenderer.invoke('auth:offline_login', payload),
    logout: (): Promise<{ success: boolean }> => ipcRenderer.invoke('auth:logout')
  },
  game: {
    launch: (payload: { account: Account; settings: IGameSettings }) => {
      ipcRenderer.invoke('game:launch', payload)
    },

    launchComputeDownload: (callback: () => void) => ipcRenderer.on('game:launch_compute_download', (_event) => callback()),

    launchDownload: (callback: (value: LauncherEvents['launch_download'][0]) => void) =>
      ipcRenderer.on('game:launch_download', (_event, value) => callback(value)),
    downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) =>
      ipcRenderer.on('game:download_progress', (_event, value) => callback(value)),
    downloadError: (callback: (value: DownloaderEvents['download_error'][0]) => void) =>
      ipcRenderer.on('game:download_error', (_event, value) => callback(value)),
    downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) =>
      ipcRenderer.on('game:download_end', (_event, value) => callback(value)),

    // Custom progress events
    assetsProgress: (callback: (data: { downloaded: number; skipped: number; total: number; percent: number }) => void) =>
      ipcRenderer.on('game:assets_progress', (_event, data) => callback(data)),
    modsProgress: (callback: (data: { current: number; total: number; percent: number }) => void) =>
      ipcRenderer.on('game:mods_progress', (_event, data) => callback(data)),
    resourcepacksProgress: (callback: (data: { current: number; total: number; percent: number }) => void) =>
      ipcRenderer.on('game:resourcepacks_progress', (_event, data) => callback(data)),

    launchInstallLoader: (callback: (value: LauncherEvents['launch_install_loader'][0]) => void) =>
      ipcRenderer.on('game:launch_install_loader', (_event, value) => callback(value)),

    launchExtractNatives: (callback: () => void) => ipcRenderer.on('game:launch_extract_natives', (_event) => callback()),
    extractProgress: (callback: (value: FilesManagerEvents['extract_progress'][0]) => void) =>
      ipcRenderer.on('game:extract_progress', (_event, value) => callback(value)),
    extractEnd: (callback: (value: FilesManagerEvents['extract_end'][0]) => void) =>
      ipcRenderer.on('game:extract_end', (_event, value) => callback(value)),
    launchCopyAssets: (callback: () => void) => ipcRenderer.on('game:launch_copy_assets', (_event) => callback()),
    copyProgress: (callback: (value: FilesManagerEvents['copy_progress'][0]) => void) =>
      ipcRenderer.on('game:copy_progress', (_event, value) => callback(value)),
    copyEnd: (callback: (value: FilesManagerEvents['copy_end'][0]) => void) => ipcRenderer.on('game:copy_end', (_event, value) => callback(value)),
    launchPatchLoader: (callback: () => void) => ipcRenderer.on('game:launch_patch_loader', (_event) => callback()),
    patchProgress: (callback: (value: PatcherEvents['patch_progress'][0]) => void) =>
      ipcRenderer.on('game:patch_progress', (_event, value) => callback(value)),
    patchError: (callback: (value: PatcherEvents['patch_error'][0]) => void) =>
      ipcRenderer.on('game:patch_error', (_event, value) => callback(value)),
    patchEnd: (callback: (value: PatcherEvents['patch_end'][0]) => void) => ipcRenderer.on('game:patch_end', (_event, value) => callback(value)),
    launchCheckJava: (callback: () => void) => ipcRenderer.on('game:launch_check_java', (_event) => callback()),
    javaInfo: (callback: (value: JavaEvents['java_info'][0]) => void) => ipcRenderer.on('game:java_info', (_event, value) => callback(value)),

    launchClean: (callback: () => void) => ipcRenderer.on('game:launch_clean', (_event) => callback()),
    cleanProgress: (callback: (value: CleanerEvents['clean_progress'][0]) => void) =>
      ipcRenderer.on('game:clean_progress', (_event, value) => callback(value)),
    cleanEnd: (callback: (value: CleanerEvents['clean_end'][0]) => void) => ipcRenderer.on('game:clean_end', (_event, value) => callback(value)),
    launchLaunch: (callback: (value: LauncherEvents['launch_launch'][0]) => void) =>
      ipcRenderer.on('game:launch_launch', (_event, value) => callback(value)),
    launched: (callback: () => void) => ipcRenderer.on('game:launched', (_event) => callback()),
    accountInvalidated: (callback: (value: { reason: string }) => void) =>
      ipcRenderer.on('game:account_invalidated', (_event, value) => callback(value)),

    launchData: (callback: (value: LauncherEvents['launch_data'][0]) => void) =>
      ipcRenderer.on('game:launch_data', (_event, value) => callback(value)),
    launchClose: (callback: (value: any) => void) => ipcRenderer.on('game:launch_close', (_event, value) => callback(value)),
    launchDebug: (callback: (value: LauncherEvents['launch_debug'][0]) => void) =>
      ipcRenderer.on('game:launch_debug', (_event, value) => callback(value)),
    patchDebug: (callback: (value: PatcherEvents['patch_debug'][0]) => void) => ipcRenderer.on('game:patch_debug', (_event, value) => callback(value))
  },
  server: {
    getStatus: (ip: string, port?: number): Promise<ServerStatus> => ipcRenderer.invoke('server:status', ip, port)
  },
  news: {
    getNews: (): Promise<INews[]> => ipcRenderer.invoke('news:get_news'),
    getCategories: (): Promise<any[]> => ipcRenderer.invoke('news:get_categories')
  },
  background: {
    get: (): Promise<IBackground | null> => ipcRenderer.invoke('background:get')
  },
  maintenance: {
    get: (): Promise<IMaintenance | null> => ipcRenderer.invoke('maintenance:get')
  },
  launcherInfo: {
    get: (): Promise<ILauncherInfo> => ipcRenderer.invoke('launcher:info')
  },
  bootstraps: {
    check: (): Promise<IBootstraps> => ipcRenderer.invoke('bootstraps:check'),
    download: (): Promise<string> => ipcRenderer.invoke('bootstraps:download'),
    install: (): Promise<void> => ipcRenderer.invoke('bootstraps:install'),
    downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) =>
      ipcRenderer.on('bootstraps:download_progress', (_event, value) => callback(value)),
    downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) =>
      ipcRenderer.on('bootstraps:download_end', (_event, value) => callback(value)),
    error: (callback: (value: BootstrapsEvents['bootstraps_error'][0]) => void) =>
      ipcRenderer.on('bootstraps:error', (_event, value) => callback(value))
  },
  settings: {
    get: (): Promise<IGameSettings> => ipcRenderer.invoke('settings:get'),
    set: (s: IGameSettings): Promise<boolean> => ipcRenderer.invoke('settings:set', s),
    pickJava: (): Promise<string | null> => ipcRenderer.invoke('settings:pick_java')
  },
  system: {
    getInfo: (): Promise<ISystemInfo> => ipcRenderer.invoke('system:info')
  }
})
