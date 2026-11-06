import { useMemo, useState } from 'react'
import type { MediaCategory, MediaRecord } from '../../shared/types'
import { DEFAULT_BROWSE_STATE, type BrowseState } from './browse/browseState'
import { MediaBrowser } from './browse/MediaBrowser'
import { MediaDetail } from './detail/MediaDetail'
import { DiscoverPage } from './discover/DiscoverPage'
import { Sidebar, type View } from './layout/Sidebar'
import { SourcesPage } from './library/SourcesPage'
import { useLibrary } from './library/useLibrary'
import { MediaPlayer } from './player/MediaPlayer'
import { useTheme } from './theme/useTheme'
import './App.css'

function App() {
  const library = useLibrary()
  const [theme, setTheme] = useTheme()
  const [view, setView] = useState<View>({ name: 'section', category: 'film' })
  /** what the player was last asked to play - kept as the clicked record so library refreshes don't reload it */
  const [nowPlaying, setNowPlaying] = useState<MediaRecord | null>(null)
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

  const isIndexing =
    Object.keys(library.scanning).length > 0 || Object.keys(library.indexing).length > 0

  function play(media: MediaRecord): void {
    setNowPlaying(media)
    setView({ name: 'player' })
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
        isIndexing={isIndexing}
        theme={theme}
        onNavigate={setView}
        onThemeChange={setTheme}
      />

      <main className="app__content">
        {renderView()}
        {/* always mounted so audio keeps playing while browsing - only hidden outside the player view */}
        <div className="app__player" hidden={view.name !== 'player'}>
          <MediaPlayer libraryMedia={nowPlaying} isActive={view.name === 'player'} />
        </div>
      </main>
    </div>
  )
}

export default App
