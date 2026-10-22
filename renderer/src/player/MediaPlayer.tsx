import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import './MediaPlayer.css'

type MediaKind = 'video' | 'audio'

interface LoadedMedia {
  url: string
  kind: MediaKind
  name: string
}

function kindFromFile(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

export function MediaPlayer() {
  const [media, setMedia] = useState<LoadedMedia | null>(null)
  const [error, setError] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  // revoke the last object URL whenever it gets replaced or the component unmounts
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const kind = kindFromFile(file)
    if (!kind) {
      setError(`Format non reconnu : ${file.type || file.name}`)
      setMedia(null)
      return
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setError(null)
    setMedia({ url, kind, name: file.name })
  }

  return (
    <section className="media-player">
      <label className="media-player__picker">
        <input type="file" accept="video/*,audio/*" onChange={handleFileChange} />
        Choisir un fichier video ou audio
      </label>

      {error && <p className="media-player__error">{error}</p>}

      {media && (
        <div className="media-player__stage">
          <p className="media-player__name">{media.name}</p>
          {media.kind === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- controls land in Issue 2.2
            <video key={media.url} className="media-player__video" src={media.url} controls autoPlay />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- controls land in Issue 2.2
            <audio key={media.url} className="media-player__audio" src={media.url} controls autoPlay />
          )}
        </div>
      )}
    </section>
  )
}
