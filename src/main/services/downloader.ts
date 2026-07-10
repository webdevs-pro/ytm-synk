import { spawn } from 'child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, normalize } from 'path'
import type { DownloaderInfo } from '../../shared/types'
import { refreshYtDlpCookiesFile } from './cookies'
import { resolveJsRuntime } from './jsRuntime'
import { getCookiesPath, getFfmpegPath, getYtDlpPath } from './paths'

export interface DownloadOptions {
  videoId: string
  outputDir: string
  outputTemplate: string
  expectedFileName: string
  quality: string
  onProgress?: (percent: number, line: string) => void
}

export interface DownloadResult {
  filePath: string
}

const AUDIO_EXT_PATTERN = /\.(mp3|m4a|opus|webm|mp4)$/i

function extractOutputPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => AUDIO_EXT_PATTERN.test(line))
}

function findNewestAudioFile(outputDir: string, sinceMs: number): string | null {
  let newest: { path: string; mtimeMs: number } | null = null

  let entries: string[] = []
  try {
    entries = readdirSync(outputDir)
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!/\.(mp3|m4a|opus)$/i.test(entry)) continue
    const filePath = join(outputDir, entry)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(filePath).mtimeMs
    } catch {
      continue
    }
    if (mtimeMs < sinceMs - 1000) continue
    if (!newest || mtimeMs > newest.mtimeMs) {
      newest = { path: filePath, mtimeMs }
    }
  }

  return newest?.path ?? null
}

function resolveDownloadedFilePath(
  stdout: string,
  stderr: string,
  outputDir: string,
  expectedFileName: string,
  startedAtMs: number
): string | null {
  for (const candidate of [...extractOutputPaths(stdout), ...extractOutputPaths(stderr)]) {
    if (existsSync(candidate)) return candidate
  }

  const expectedPath = join(outputDir, expectedFileName)
  if (existsSync(expectedPath)) return expectedPath

  const stem = expectedFileName.replace(/\.mp3$/i, '')
  try {
    for (const entry of readdirSync(outputDir)) {
      if (!entry.toLowerCase().endsWith('.mp3')) continue
      if (entry.replace(/\.mp3$/i, '') === stem) {
        return join(outputDir, entry)
      }
    }
  } catch {
    // outputDir may be missing
  }

  return findNewestAudioFile(outputDir, startedAtMs)
}

function prepareOutputPath(outputDir: string, outputTemplate: string): {
  outputDir: string
  outputTemplate: string
  expectedFileName: string
  expectedFilePath: string
} {
  const normalizedDir = normalize(outputDir)
  const normalizedTemplate = outputTemplate.replace(/\\/g, '_').replace(/\//g, '_')
  const expectedFileName = normalizedTemplate.replace(/\.%\(ext\)s$/i, '.mp3')
  const expectedFilePath = join(normalizedDir, expectedFileName)

  if (existsSync(expectedFilePath)) {
    return { outputDir: normalizedDir, outputTemplate: normalizedTemplate, expectedFileName, expectedFilePath }
  }

  const tempFilePath = join(normalizedDir, expectedFileName.replace(/\.mp3$/i, '.temp.mp3'))
  if (existsSync(tempFilePath)) {
    try {
      unlinkSync(tempFilePath)
    } catch {
      // Another process may hold the temp file; yt-dlp will surface the error.
    }
  }

  return { outputDir: normalizedDir, outputTemplate: normalizedTemplate, expectedFileName, expectedFilePath }
}

export class DownloaderService {
  getInfo(): DownloaderInfo {
    const ytdlpPath = getYtDlpPath()
    const ffmpegPath = getFfmpegPath()
    const jsRuntime = resolveJsRuntime()
    return {
      ytdlpPath,
      ffmpegPath,
      ytdlpExists: existsSync(ytdlpPath),
      ffmpegExists: existsSync(ffmpegPath),
      jsRuntimeKind: jsRuntime?.kind ?? null,
      jsRuntimeExists: Boolean(jsRuntime)
    }
  }

  async getVersion(): Promise<string | null> {
    const info = this.getInfo()
    if (!info.ytdlpExists) return null
    return new Promise((resolve) => {
      const proc = spawn(info.ytdlpPath, ['--version'], { windowsHide: true })
      let output = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      proc.on('close', () => resolve(output.trim() || null))
      proc.on('error', () => resolve(null))
    })
  }

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const info = this.getInfo()
    if (!info.ytdlpExists) {
      throw new Error(`yt-dlp not found at ${info.ytdlpPath}. Run npm run download-binaries.`)
    }

    await refreshYtDlpCookiesFile()

    const jsRuntime = resolveJsRuntime()
    if (!jsRuntime) {
      throw new Error(
        'No JavaScript runtime found for yt-dlp. Install Node.js or run npm run download-binaries to bundle Deno.'
      )
    }

    const prepared = prepareOutputPath(options.outputDir, options.outputTemplate)
    if (existsSync(prepared.expectedFilePath)) {
      return { filePath: prepared.expectedFilePath }
    }

    const url = `https://music.youtube.com/watch?v=${options.videoId}`
    const args = [
      '--js-runtimes',
      `${jsRuntime.kind}:${jsRuntime.path}`,
      '--cookies',
      getCookiesPath(),
      '--ffmpeg-location',
      info.ffmpegPath,
      '-f',
      'bestaudio/best',
      '-x',
      '--audio-format',
      'mp3',
      ...(options.quality === 'best'
        ? ['--audio-quality', '0']
        : ['--audio-quality', `${options.quality}K`]),
      '-o',
      join(prepared.outputDir, prepared.outputTemplate),
      '--embed-thumbnail',
      '--add-metadata',
      '--no-playlist',
      '--print',
      'after_move:%(filepath)s',
      url
    ]

    const startedAtMs = Date.now()
    const filePath = await new Promise<string>((resolve, reject) => {
      const proc = spawn(info.ytdlpPath, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        const line = chunk.toString()
        stderr += line
        const match = line.match(/(\d+(?:\.\d+)?)%/)
        if (match && options.onProgress) {
          options.onProgress(Number(match[1]), line.trim())
        }
      })

      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`))
          return
        }

        const resolved = resolveDownloadedFilePath(
          stdout,
          stderr,
          prepared.outputDir,
          prepared.expectedFileName,
          startedAtMs
        )
        if (resolved) {
          resolve(resolved)
          return
        }

        reject(new Error('Download finished but output file was not found'))
      })
    })

    return { filePath }
  }
}

export const downloaderService = new DownloaderService()
