declare module 'eml-lib' {
  import { EventEmitter } from 'node:events'

  export interface IBackground {
    file?: { url?: string }
  }

  export interface IMaintenance {
    startTime: string
    endTime: string
    message?: string
  }

  export interface INews {
    id: number
    title: string
    content: string
    date: string
  }

  export interface IBootstraps {
    updateAvailable: boolean
    version?: string
    size?: number
    downloadUrl?: string
  }

  export interface Account {
    name: string
    uuid: string
    accessToken: string
    clientToken: string
    meta: { type: string; online: boolean } & Record<string, any>
  }

  export class Bootstraps extends EventEmitter {
    constructor(url: string)
    checkForUpdate(): Promise<IBootstraps>
    download(): Promise<string>
    runUpdate(): Promise<void>
    on(event: 'download_progress' | 'download_end' | 'bootstraps_error', listener: (data: any) => void): this
  }

  export class News {
    constructor(url: string)
    getNews(): Promise<INews[]>
    getCategories(): Promise<any[]>
  }

  export class ServerStatus {
    constructor(ip: string, port: number, protocol: 'modern', timeout: number)
    getStatus(): Promise<any>
  }

  export type BootstrapsEvents = { bootstraps_error: [any] }
  export type DownloaderEvents = { download_progress: [any]; download_error: [any]; download_end: [any] }
  export type FilesManagerEvents = { extract_progress: [any]; extract_end: [any]; copy_progress: [any]; copy_end: [any] }
  export type JavaEvents = { java_info: [any] }
  export type LauncherEvents = {
    launch_download: [any]
    launch_install_loader: [any]
    launch_launch: [any]
    launch_data: [any]
    launch_close: [any]
    launch_debug: [any]
  }
  export type PatcherEvents = { patch_progress: [any]; patch_error: [any]; patch_end: [any]; patch_debug: [any] }
  export type CleanerEvents = { clean_progress: [any]; clean_end: [any] }
}

declare module 'eml-lib/types/status' {
  export interface ServerStatus {
    online: boolean
    players: { online: number; max: number }
    version: string
    description: string
    [key: string]: any
  }
}

declare module 'adm-zip'