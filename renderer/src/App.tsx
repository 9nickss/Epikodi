import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaCategory, MediaRecord } from '../../shared/types'
import { DEFAULT_BROWSE_STATE, type BrowseState } from './browse/browseState'
import { displayTitle } from './format'
import { MediaBrowser } from './browse/MediaBrowser'
import { MediaDetail } from './detail/MediaDetail'
import { DiscoverPage } from './discover/DiscoverPage'
import { Sidebar, type View } from './layout/Sidebar'
import { SourcesPage } from './library/SourcesPage'
import { useLibrary } from './library/useLibrary'
import { useSpatialNavigation } from './navigation/useSpatialNavigation'
import { MediaPlayer } from './player/MediaPlayer'
import type { StreamMedia } from './player/nowPlaying'
import { QueuePanel } from './queue/QueuePanel'
import { useQueue } from './queue/useQueue'
import { PluginsPage } from './plugins/PluginsPage'
import { SettingsPage } from './settings/SettingsPage'
import { useTvMode } from './settings/useTvMode'
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
  const tvMode = useTvMode()
  const [view, setView] = useState<View>({ name: 'section', category: 'film' })
  /** what's playing and what comes next (#3.3) */
  const queue = useQueue(library.media, library.isLoaded)
  const { nowPlaying } = queue
  /** short confirmation at the bottom of the window ("Ajoute a la file"...) */
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])
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

  /** where Escape goes back to from the player */
  const lastPageRef = useRef<View>(view)
  useEffect(() => {
    if (view.name !== 'player') lastPageRef.current = view
  }, [view])

  /** Escape (#2.2): one level up - detail -> its section, movie -> Discover, player -> last page */
  function goBack(): void {
    switch (view.name) {
      case 'detail':
        setView({ name: 'section', category: view.category })
        break
      case 'discover':
        if (view.movie) setView({ name: 'discover', movie: null })
        break
      case 'player':
        setView(lastPageRef.current)
        break
    }
  }

  useSpatialNavigation({ arrowsEnabled: view.name !== 'player', onBack: goBack })

  const isIndexing =
    Object.keys(library.scanning).length > 0 || Object.keys(library.indexing).length > 0

  function play(media: MediaRecord): void {
    queue.playNow(media)
    setView({ name: 'player' })
  }

  /** "Tout lire" (#3.3): a section, an album, a folder */
  function playAll(list: MediaRecord[], start = 0): void {
    if (list.length === 0) return
    queue.playAll(list, start)
    setView({ name: 'player' })
  }

  /** ＋ (#3.3): stays on the page, a notice confirms */
  function enqueue(list: MediaRecord[]): void {
    if (list.length === 0) return
    queue.enqueue(list)
    setNotice(
      list.length === 1
        ? `Ajoute a la file : ${displayTitle(list[0])}`
        : `${list.length} elements ajoutes a la file`,
    )
  }

  /** a plugin asked to play a stream (Issue 6.3) - stays on the plugin page, like a remote */
  function playStream(stream: StreamMedia): void {
    queue.playStream(stream)
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
            onPlayAll={playAll}
            onEnqueue={(media) => enqueue([media])}
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
            onPlayAll={playAll}
            onEnqueue={(item) => enqueue([item])}
            library={library.media}
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
        return <SourcesPage library={library} onPlayMedia={play} onPlayAll={playAll} />
      case 'settings':
        return <SettingsPage tvMode={tvMode} />
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
          <MediaPlayer
            nowPlaying={nowPlaying}
            isActive={view.name === 'player'}
            hasPrevious={queue.hasPrevious}
            hasNext={queue.hasNext}
            onPrevious={queue.previous}
            onNext={queue.next}
          />
          <QueuePanel
            entries={queue.entries}
            index={queue.index}
            onJump={queue.jumpTo}
            onRemove={queue.remove}
            onClear={queue.clear}
          />
        </div>
      </main>

      {notice && (
        <p className="app__notice" role="status">
          {notice}
        </p>
      )}

      {theme.intro && (
        <MetroIntro key={theme.intro} faction={theme.intro} onDone={theme.endIntro} />
      )}
    </div>
  )
}

export default App
