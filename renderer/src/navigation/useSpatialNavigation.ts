import { useEffect, useRef } from 'react'

/**
 * Keyboard / remote navigation (#2.2): the arrows move the focus to the
 * nearest focusable element in that direction, like a TV interface. It reads
 * the layout from the DOM, so every page works without per-component code
 * (sidebar, "Continue watching" rows, grid, Discover, settings...).
 *
 * Enter is the native button activation; Escape calls onBack.
 */

type Direction = 'up' | 'down' | 'left' | 'right'

const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'number', ''])

function isVisible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * keys the focused control needs for itself: arrows move the caret in a text
 * field, change a <select> or a slider - except up/down out of a single-line
 * field, which is how you leave the search box
 */
function keepsKey(element: Element | null, direction: Direction): boolean {
  if (!element) return false
  if (element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLInputElement) {
    if (element.type === 'range') return true
    if (TEXT_INPUT_TYPES.has(element.type)) return direction === 'left' || direction === 'right'
  }
  return false
}

function candidatesIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible)
}

/**
 * Nearest element whose box lies in the direction: distance along the axis,
 * plus the sideways offset weighted more, so moving down a grid column stays
 * in the column rather than jumping to a closer item diagonally.
 */
function nearest(
  from: DOMRect,
  direction: Direction,
  candidates: HTMLElement[],
): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestScore = Infinity
  const fromCenterX = from.left + from.width / 2
  const fromCenterY = from.top + from.height / 2

  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    let along: number
    let across: number
    switch (direction) {
      case 'up':
        along = from.top - rect.bottom
        across = Math.max(0, rect.left - from.right, from.left - rect.right)
        if (centerY >= fromCenterY) continue
        break
      case 'down':
        along = rect.top - from.bottom
        across = Math.max(0, rect.left - from.right, from.left - rect.right)
        if (centerY <= fromCenterY) continue
        break
      case 'left':
        along = from.left - rect.right
        across = Math.max(0, rect.top - from.bottom, from.top - rect.bottom)
        if (centerX >= fromCenterX) continue
        break
      case 'right':
        along = rect.left - from.right
        across = Math.max(0, rect.top - from.bottom, from.top - rect.bottom)
        if (centerX <= fromCenterX) continue
        break
    }
    // overlapping boxes (a play button over its card) still count, just closer
    const score = Math.max(along, -8) + across * 3
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

function focus(element: HTMLElement): void {
  element.focus({ preventScroll: true })
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

interface SpatialNavigationOptions {
  /** off while the player is on screen: its arrows seek and change the volume */
  arrowsEnabled: boolean
  /** Escape - back to the previous page */
  onBack: () => void
}

export function useSpatialNavigation({ arrowsEnabled, onBack }: SpatialNavigationOptions): void {
  const optionsRef = useRef({ arrowsEnabled, onBack })
  useEffect(() => {
    optionsRef.current = { arrowsEnabled, onBack }
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null

      if (event.key === 'Escape') {
        // fullscreen and open <select>s handle their own Escape; a search box clears itself
        if (document.fullscreenElement) return
        if (
          active instanceof HTMLInputElement &&
          active.value &&
          TEXT_INPUT_TYPES.has(active.type)
        ) {
          return
        }
        optionsRef.current.onBack()
        return
      }

      const direction = KEY_DIRECTIONS[event.key]
      if (!direction || !optionsRef.current.arrowsEnabled || keepsKey(active, direction)) return

      const app = document.querySelector('.app')
      if (!app) return
      const candidates = candidatesIn(app)
      if (candidates.length === 0) return
      event.preventDefault()

      // nothing focused yet (or the focused element just disappeared): start in the page content
      if (!active || active === document.body || !app.contains(active) || !isVisible(active)) {
        const content = candidatesIn(app.querySelector('.app__content') ?? app)
        const start =
          content[0] ?? app.querySelector<HTMLElement>('.sidebar__item.is-active') ?? candidates[0]
        focus(start)
        return
      }

      const target = nearest(
        active.getBoundingClientRect(),
        direction,
        candidates.filter((candidate) => candidate !== active),
      )
      if (target) focus(target)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
