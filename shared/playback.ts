/** under this, nothing worth resuming was watched (Issue F1.1) */
const RESUME_MIN_SECONDS = 30
/** past this share of the duration only credits are left: the media counts as watched */
const WATCHED_RATIO = 0.95

export function isWatched(positionSeconds: number, durationSeconds: number): boolean {
  return positionSeconds >= durationSeconds * WATCHED_RATIO
}

/** shared by the resume offer and the "Continuer" row, so one never promises what the other won't do */
export function canResume(positionSeconds: number, durationSeconds: number): boolean {
  return positionSeconds >= RESUME_MIN_SECONDS && !isWatched(positionSeconds, durationSeconds)
}
