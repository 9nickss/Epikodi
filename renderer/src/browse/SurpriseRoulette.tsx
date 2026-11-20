import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MediaRecord } from '../../../shared/types'
import { displayTitle } from '../format'
import { prefersReducedMotion } from '../theme/themeTransition'
import { Artwork } from './Artwork'
import './SurpriseRoulette.css'

/** frames shown before landing - each one a bit slower, like a wheel losing speed */
const SPIN_STEPS = 16
const FIRST_STEP_MS = 55
const LAST_STEP_MS = 320
/** time to read the winner before it starts */
const LAUNCH_DELAY_MS = 1300

function pickRandom<T>(items: readonly T[], avoid?: T): T {
  if (items.length === 1) return items[0]
  let pick: T
  do pick = items[Math.floor(Math.random() * items.length)]
  while (pick === avoid)
  return pick
}

interface SurpriseRouletteProps {
  /** what the draw can land on - never empty */
  pool: MediaRecord[]
  onPlay: (media: MediaRecord) => void
  onClose: () => void
}

/**
 * "Surprends-moi" (#2.4): flips through random items of the section, slows
 * down, lands on one and plays it. Escape or Annuler stops it, Encore draws
 * again. Without animations (prefers-reduced-motion) it plays right away.
 */
export function SurpriseRoulette({ pool, onPlay, onClose }: SurpriseRouletteProps) {
  const [shown, setShown] = useState<MediaRecord>(() => pickRandom(pool))
  const [step, setStep] = useState(0)
  const [winner, setWinner] = useState<MediaRecord | null>(null)
  const [round, setRound] = useState(0)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // the latest callbacks, for timers started once per round
  const callbacksRef = useRef({ onPlay, onClose })
  useEffect(() => {
    callbacksRef.current = { onPlay, onClose }
  })

  useEffect(() => {
    const target = pickRandom(pool)
    if (prefersReducedMotion()) {
      callbacksRef.current.onPlay(target)
      return
    }
    let current = 0
    let timer: number
    let previous: MediaRecord | undefined
    const tick = (): void => {
      current += 1
      setStep(current)
      if (current >= SPIN_STEPS) {
        setShown(target)
        setWinner(target)
        timer = window.setTimeout(() => callbacksRef.current.onPlay(target), LAUNCH_DELAY_MS)
        return
      }
      previous = pickRandom(pool, previous)
      setShown(previous)
      // ease-out: delays grow quadratically towards the landing
      const progress = current / SPIN_STEPS
      timer = window.setTimeout(
        tick,
        FIRST_STEP_MS + (LAST_STEP_MS - FIRST_STEP_MS) * progress ** 2,
      )
    }
    timer = window.setTimeout(tick, FIRST_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [pool, round])

  useEffect(() => {
    cancelRef.current?.focus()
    // capture phase: runs before the page's Escape (back navigation, useSpatialNavigation)
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      callbacksRef.current.onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // on <body>: the page content has its own stacking contexts (card hover lifts...)
  return createPortal(
    <div className="surprise" role="dialog" aria-modal="true" aria-label="Surprends-moi">
      <div className="surprise__panel">
        <p className="surprise__heading">{winner ? 'Et ce sera…' : '🎲 Tirage au sort…'}</p>
        <div
          key={`${round}-${step}`}
          className={`surprise__card${winner ? ' is-winner' : ''}`}
          aria-live="polite"
        >
          <Artwork media={shown} size="poster" />
          <p className="surprise__title">{displayTitle(shown)}</p>
        </div>
        <div className="surprise__actions">
          <button ref={cancelRef} type="button" onClick={onClose}>
            Annuler
          </button>
          {pool.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setWinner(null)
                setRound((value) => value + 1)
              }}
            >
              🎲 Encore
            </button>
          )}
          {winner && (
            <button
              type="button"
              className="surprise__play"
              onClick={() => callbacksRef.current.onPlay(winner)}
            >
              ▶ Lancer maintenant
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
