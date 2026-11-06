import { useState, type AnimationEvent, type ReactNode } from 'react'
import { METRO_FACTIONS, type MetroFaction } from './themes'
import './MetroIntro.css'

/** optional local images shown full window, see public/metro/README.md */
const INTRO_IMAGES: Readonly<Partial<Record<MetroFaction, string>>> = {
  base: 'metro.jpg',
  'dark-ones': 'dark ones.jpg',
  'red-line': 'red star.jpg',
}

/** drawn art, used when there is no image for the faction or its file isn't there */
const FALLBACKS: Readonly<Record<MetroFaction, ReactNode>> = {
  base: (
    <svg viewBox="0 0 200 260" aria-hidden="true">
      <path
        fill="#1b1a16"
        d="M100 8c-46 0-72 34-72 82 0 30 8 54 20 72l-30 36c-8 10-14 32-14 62h192c0-30-6-52-14-62l-30-36c12-18 20-42 20-72 0-48-26-82-72-82z"
      />
      <path fill="#2e2c25" d="M52 84c0-14 96-14 96 0v52c0 26-22 50-48 50s-48-24-48-50z" />
      <circle cx="74" cy="104" r="19" fill="#7fd85a" opacity="0.75" />
      <circle cx="126" cy="104" r="19" fill="#7fd85a" opacity="0.75" />
      <circle cx="100" cy="166" r="24" fill="#47443a" />
      <circle cx="100" cy="166" r="13" fill="#14130f" />
    </svg>
  ),
  'dark-ones': (
    <svg viewBox="0 0 200 90" aria-hidden="true">
      <path fill="#d7ecf7" d="M6 30c26-14 58-12 80 26-34 10-64 0-80-26z" />
      <path fill="#d7ecf7" d="M194 30c-26-14-58-12-80 26 34 10 64 0 80-26z" />
      <ellipse cx="58" cy="38" rx="5" ry="13" fill="#081018" />
      <ellipse cx="142" cy="38" rx="5" ry="13" fill="#081018" />
    </svg>
  ),
  'red-line': (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path fill="#e5483f" d="M100 10l23 65h69l-55 42 20 67-57-40-57 40 20-67-55-42h69z" />
    </svg>
  ),
}

interface MetroIntroProps {
  faction: MetroFaction
  onDone: () => void
}

/** full-window animation of the Metro theme: Artyom on activation, then one per faction */
export function MetroIntro({ faction, onDone }: MetroIntroProps) {
  const image = INTRO_IMAGES[faction]
  const [hasImage, setHasImage] = useState(image !== undefined)

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget && event.animationName === 'metro-intro-out') onDone()
  }

  return (
    <div
      className={`metro-intro metro-intro--${faction}${hasImage ? ' metro-intro--scene' : ''}`}
      aria-hidden="true"
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="metro-intro__stage">
        <div className="metro-intro__art">
          {hasImage ? (
            <img
              src={`${import.meta.env.BASE_URL}metro/${encodeURIComponent(image ?? '')}`}
              alt=""
              draggable={false}
              onError={() => setHasImage(false)}
            />
          ) : (
            FALLBACKS[faction]
          )}
        </div>
        <p className="metro-intro__name">{METRO_FACTIONS[faction].label}</p>
      </div>
      <div className="metro-intro__shade" />
    </div>
  )
}
