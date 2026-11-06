import { flushSync } from 'react-dom'

const REVEAL_DURATION_MS = 600

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Applies a theme change with a circle opening from `origin` over the whole
 * window, the new colors showing inside it. `change` must update the DOM
 * synchronously - the browser snapshots the page before and after it.
 */
export function animateThemeChange(origin: HTMLElement, change: () => void): void {
  if (prefersReducedMotion()) {
    change()
    return
  }

  const { left, top, width, height } = origin.getBoundingClientRect()
  const x = left + width / 2
  const y = top + height / 2
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

  const transition = document.startViewTransition(() => flushSync(change))
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: REVEAL_DURATION_MS,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    // a new change during the animation skips this one - the theme is still applied
    .catch(() => {})
}
