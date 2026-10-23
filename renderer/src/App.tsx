import { useState } from 'react'
import type { MediaRecord } from '../../shared/types'
import { Library } from './library/Library'
import { MediaPlayer } from './player/MediaPlayer'
import './App.css'

function App() {
  const [selectedMedia, setSelectedMedia] = useState<MediaRecord | null>(null)

  return (
    <main className="app">
      <header className="app__header">
        <h1>EpiKodi</h1>
        <p>Lecteur multimedia</p>
      </header>

      <Library onPlayMedia={setSelectedMedia} />
      <MediaPlayer libraryMedia={selectedMedia} />
    </main>
  )
}

export default App
