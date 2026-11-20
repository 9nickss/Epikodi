import { PLUGIN_PERMISSION_LABELS, type PluginInfo } from '../../../shared/plugins'
import type { PluginsState } from './usePlugins'
import './Plugins.css'

interface PluginsPageProps {
  plugins: PluginsState
  onOpen: (plugin: PluginInfo) => void
}

/** installed plugins, their permissions and the folders that failed to load (Issue 6.2) */
export function PluginsPage({ plugins, onOpen }: PluginsPageProps) {
  const { list } = plugins

  return (
    <section className="plugins-page">
      <header className="plugins-page__header">
        <h2>Plugins</h2>
        <div className="plugins-page__actions">
          <button type="button" onClick={() => void plugins.reload()}>
            ↻ Recharger
          </button>
          <button type="button" onClick={() => void plugins.openFolder()}>
            📂 Ouvrir le dossier
          </button>
        </div>
      </header>

      <p className="plugins-page__intro">
        Un plugin est un dossier avec un <code>manifest.json</code> et une page web, qui ajoute une
        section a la barre laterale. Il tourne isole du reste d'EpiKodi et n'a acces qu'a ce que ses
        permissions autorisent. Pour en installer un, copie son dossier dans{' '}
        {list ? <code>{list.userDirectory}</code> : 'le dossier des plugins'} puis clique sur
        Recharger. La doc d'ecriture est dans <code>plugins/README.md</code>.
      </p>

      {plugins.error && <p className="plugins-page__error">{plugins.error}</p>}

      {list && list.errors.length > 0 && (
        <div className="plugins-page__failures">
          <h3>
            {list.errors.length} plugin{list.errors.length > 1 ? 's' : ''} non charge
            {list.errors.length > 1 ? 's' : ''}
          </h3>
          <ul>
            {list.errors.map((failure) => (
              <li key={failure.directory}>
                <code>{failure.directory}</code>
                <span>{failure.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {list && list.plugins.length === 0 && (
        <p className="plugins-page__empty">Aucun plugin installe.</p>
      )}

      <ul className="plugins-page__list">
        {list?.plugins.map((plugin) => {
          const { manifest } = plugin
          return (
            <li
              key={manifest.id}
              className={`plugins-page__card${plugin.enabled ? '' : ' is-disabled'}`}
            >
              <span className="plugins-page__icon" aria-hidden="true">
                {manifest.section.icon}
              </span>
              <div className="plugins-page__body">
                <p className="plugins-page__name">
                  {manifest.name}
                  <span className="plugins-page__version">v{manifest.version}</span>
                  <span className="plugins-page__badge">
                    {plugin.isBundled ? 'Exemple integre' : 'Installe'}
                  </span>
                </p>
                {manifest.description && (
                  <p className="plugins-page__description">{manifest.description}</p>
                )}
                <p className="plugins-page__details">
                  Section « {manifest.section.label} »
                  {manifest.author ? ` · par ${manifest.author}` : ''}
                  {' · '}
                  {manifest.permissions.length > 0
                    ? manifest.permissions
                        .map((permission) => PLUGIN_PERMISSION_LABELS[permission])
                        .join(', ')
                    : 'aucune permission'}
                </p>
              </div>
              <div className="plugins-page__controls">
                {plugin.enabled && (
                  <button type="button" onClick={() => onOpen(plugin)}>
                    Ouvrir
                  </button>
                )}
                <label className="plugins-page__toggle">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={(event) =>
                      void plugins.setEnabled(manifest.id, event.currentTarget.checked)
                    }
                  />
                  {plugin.enabled ? 'Active' : 'Desactive'}
                </label>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
