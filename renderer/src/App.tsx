import { useEffect, useMemo, useState } from 'react'
import type { MediaCategory, MediaRecord } from '../../shared/types'
import { DEFAULT_BROWSE_STATE, type BrowseState } from './browse/browseState'
import { MediaBrowser } from './browse/MediaBrowser'
import { MediaDetail } from './detail/MediaDetail'
import { DiscoverPage } from './discover/DiscoverPage'
import { Sidebar, type View } from './layout/Sidebar'
import { SourcesPage } from './library/SourcesPage'
import { useLibrary } from './library/useLibrary'
import { MediaPlayer } from './player/MediaPlayer'
import type { NowPlaying, StreamMedia } from './player/nowPlaying'
import { PluginsPage } from './plugins/PluginsPage'
import { SettingsPage } from './settings/SettingsPage'
import { PluginView } from './plugins/PluginView'
import { usePlugins } from './plugins/usePlugins'
import { MetroIntro } from './theme/MetroIntro'
import './theme/metroTheme.css'
import { useTheme } from './theme/useTheme'
import './App.css'

function App() {
  const library = useLibrary()
  const theme = useTheme()
  const plugins = usePlugins()
  const [view, setView] = useState<View>({ name: 'section', category: 'film' })
  /** what the player was last asked to play - kept as the clicked record so library refreshes don't reload it */
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null)
  /** search/sort/mode per section, kept when visiting a detail page and coming back */
  const [browseStates, setBrowseStates] =
    useState<Record<MediaCategory, BrowseState>>(DEFAULT_BROWSE_STATE)

  const byCategory = useMemo(() => {
    const grouped: Record<MediaCategory, MediaRecord[]> = { film: [], music: [], podcast: [] }
    for (const item of library.media) grouped[item.category].push(item)
    return grouped
  }, [library.media])

  const counts = {
    film: byCategory.film.length,
    music: byCategory.music.length,
    podcast: byCategory.podcast.length,
  }

  // playback saves don't go through the library state: pick up the progress when coming back
  const sectionShown = view.name === 'section' ? view.category : null
  useEffect(() => {
    if (sectionShown) void library.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh isn't memoized, only the section matters
  }, [sectionShown])

  const isIndexing =
    Object.keys(library.scanning).length > 0 || Object.keys(library.indexing).length > 0

  function play(media: MediaRecord): void {
    setNowPlaying({ type: 'library', media })
    setView({ name: 'player' })
  }

  /** a plugin asked to play a stream (Issue 6.3) - stays on the plugin page, like a remote */
  function playStream(stream: StreamMedia): void {
    setNowPlaying({ type: 'stream', stream })
  }

  function openDetail(media: MediaRecord): void {
    setView({ name: 'detail', mediaId: media.id, category: media.category })
  }

  function renderView() {
    switch (view.name) {
      case 'section':
        return (
          <MediaBrowser
            key={view.category}
            category={view.category}
            media={byCategory[view.category]}
            state={browseStates[view.category]}
            hasSources={library.sources.length > 0}
            onStateChange={(state) =>
              setBrowseStates((prev) => ({ ...prev, [view.category]: state }))
            }
            onOpen={openDetail}
            onPlay={play}
            onGoToSources={() => setView({ name: 'sources' })}
          />
        )
      case 'detail': {
        const media = library.media.find((item) => item.id === view.mediaId)
        if (!media) {
          return library.isLoaded ? (
            <p className="app__missing">Ce media n'est plus dans la bibliotheque.</p>
          ) : null
        }
        return (
          <MediaDetail
            key={media.id}
            media={media}
            tmdbConfigured={library.tmdbConfigured}
            onBack={() => setView({ name: 'section', category: view.category })}
            onPlay={play}
            onMediaUpdated={library.replaceMedia}
          />
        )
      }
      case 'discover':
        return (
          <DiscoverPage
            selected={view.movie}
            media={library.media}
            tmdbConfigured={library.tmdbConfigured}
            isLibraryLoaded={library.isLoaded}
            onSelect={(movie) => setView({ name: 'discover', movie })}
            onPlay={play}
            onOpenMedia={openDetail}
          />
        )
      case 'sources':
        return <SourcesPage library={library} onPlayMedia={play} />
      case 'settings':
        return <SettingsPage />
      case 'plugins':
        return (
          <PluginsPage
            plugins={plugins}
            onOpen={(plugin) => setView({ name: 'plugin', pluginId: plugin.manifest.id })}
          />
        )
      case 'plugin': {
        const plugin = plugins.enabled.find((item) => item.manifest.id === view.pluginId)
        if (!plugin) {
          return plugins.list ? (
            <p className="app__missing">
              Ce plugin n'est plus installe ou a ete desactive.{' '}
              <button
                type="button"
                className="app__link"
                onClick={() => setView({ name: 'plugins' })}
              >
                Voir les plugins
              </button>
            </p>
          ) : null
        }
        return (
          <PluginView
            key={`${plugin.manifest.id}:${plugins.generation}`}
            plugin={plugin}
            media={library.media}
            nowPlaying={nowPlaying}
            onPlayStream={playStream}
            onReload={() => void plugins.reload()}
          />
        )
      }
      case 'player':
        return null
    }
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        counts={counts}
        nowPlaying={nowPlaying}
        plugins={plugins.enabled}
        pluginErrorCount={plugins.list?.errors.length ?? 0}
        isIndexing={isIndexing}
        theme={theme}
        onNavigate={setView}
      />

      <main className="app__content">
        {renderView()}
        {/* always mounted so audio keeps playing while browsing - only hidden outside the player view */}
        <div className="app__player" hidden={view.name !== 'player'}>
          <MediaPlayer nowPlaying={nowPlaying} isActive={view.name === 'player'} />
        </div>
      </main>

      {theme.intro && (
        <MetroIntro key={theme.intro} faction={theme.intro} onDone={theme.endIntro} />
      )}
    </div>
  )
}

export default App
