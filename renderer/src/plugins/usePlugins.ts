import { useEffect, useState } from 'react'
import type { PluginInfo, PluginList } from '../../../shared/plugins'
import { ipcErrorMessage } from '../format'

export interface PluginsState {
  list: PluginList | null
  /** plugins whose section shows in the sidebar */
  enabled: PluginInfo[]
  /** last IPC failure (reload, toggle, open folder) */
  error: string | null
  /** bumped on each reload, so the open plugin page reloads too */
  generation: number
  reload: () => Promise<void>
  setEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  openFolder: () => Promise<void>
}

export function usePlugins(): PluginsState {
  const [list, setList] = useState<PluginList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    window.epikodi.listPlugins().then(setList, (cause: unknown) => setError(ipcErrorMessage(cause)))
  }, [])

  async function run(action: () => Promise<PluginList | void>): Promise<void> {
    setError(null)
    try {
      const next = await action()
      if (next) setList(next)
    } catch (cause) {
      setError(ipcErrorMessage(cause))
    }
  }

  return {
    list,
    enabled: list?.plugins.filter((plugin) => plugin.enabled) ?? [],
    error,
    generation,
    reload: () =>
      run(async () => {
        const next = await window.epikodi.reloadPlugins()
        setGeneration((value) => value + 1)
        return next
      }),
    setEnabled: (pluginId, enabled) =>
      run(() => window.epikodi.setPluginEnabled(pluginId, enabled)),
    openFolder: () => run(() => window.epikodi.openPluginsFolder()),
  }
}
