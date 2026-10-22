import { MediaPlayer } from './player/MediaPlayer'
import './App.css'

function App() {
  return (
    <main className="app">
      <header className="app__header">
        <h1>EpiKodi</h1>
        <p>Lecteur multimedia</p>
      </header>

      <MediaPlayer />
    </main>
  )
}

export default App
