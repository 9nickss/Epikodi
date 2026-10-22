import { contextBridge } from 'electron'
import type { ElectronBridge } from '../shared/types'

const bridge: ElectronBridge = {
  version: process.env.npm_package_version ?? '0.0.0',
}

contextBridge.exposeInMainWorld('epikodi', bridge)
