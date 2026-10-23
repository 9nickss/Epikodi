import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { toMediaUrl } from './protocols'

const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg'

// only one transcode runs at a time - starting a new one kills the previous
let currentJob: ChildProcess | null = null

export async function transcodeToMp4(
  inputPath: string,
  durationSeconds: number | null,
  onProgress: (percent: number) => void,
): Promise<string> {
  currentJob?.kill('SIGKILL')

  const outDir = path.join(app.getPath('temp'), 'epikodi-transcode')
  await mkdir(outDir, { recursive: true })
  const outputPath = path.join(outDir, `${randomUUID()}.mp4`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-nostats',
      '-progress',
      'pipe:1',
      outputPath,
    ])
    currentJob = child

    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000)
    })

    let stdoutBuffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=')
        // ffmpeg's `-progress` quirk: out_time_ms is actually microseconds, not milliseconds
        if (key === 'out_time_ms' && durationSeconds) {
          const seconds = Number(value) / 1_000_000
          onProgress(Math.min(100, (seconds / durationSeconds) * 100))
        } else if (key === 'progress' && value === 'end') {
          onProgress(100)
        }
      }
    })

    child.on('error', (err) => {
      if (currentJob === child) currentJob = null
      reject(err)
    })

    child.on('close', (code, signal) => {
      if (currentJob === child) currentJob = null
      if (signal) reject(new Error(`ffmpeg interrompu (${signal})`))
      else if (code === 0) resolve()
      else reject(new Error(`ffmpeg a echoue (code ${code}) : ${stderrTail.slice(-500)}`))
    })
  })

  return toMediaUrl(outputPath)
}
