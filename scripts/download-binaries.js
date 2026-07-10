const fs = require('fs')
const path = require('path')
const https = require('https')
const { execSync } = require('child_process')
const os = require('os')

const binDir = path.join(process.cwd(), 'bin')
const ytdlpPath = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

const YTDLP_URL =
  process.platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, { headers: { 'User-Agent': 'ytm-synk' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close()
          fs.unlinkSync(dest)
          download(response.headers.location, dest).then(resolve).catch(reject)
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close(resolve)
        })
      })
      .on('error', (err) => {
        fs.unlink(dest, () => reject(err))
      })
  })
}

async function copyFfmpeg() {
  let ffmpegStatic
  try {
    ffmpegStatic = require('ffmpeg-static')
  } catch {
    console.warn('ffmpeg-static not installed yet, skipping ffmpeg copy')
    return
  }
  if (!ffmpegStatic) return

  const ffmpegDest = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (!fs.existsSync(ffmpegStatic)) {
    console.warn('ffmpeg-static binary missing, skipping ffmpeg copy')
    return
  }
  fs.copyFileSync(ffmpegStatic, ffmpegDest)
  if (process.platform !== 'win32') {
    fs.chmodSync(ffmpegDest, 0o755)
  }
  console.log(`Copied ffmpeg to ${ffmpegDest}`)
}

function getDenoAssetName() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `deno-${arch}-pc-windows-msvc.zip`
  if (process.platform === 'darwin') {
    return arch === 'aarch64' ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip'
  }
  return `deno-${arch}-unknown-linux-gnu.zip`
}

async function downloadDeno() {
  const denoName = process.platform === 'win32' ? 'deno.exe' : 'deno'
  const denoDest = path.join(binDir, denoName)
  if (fs.existsSync(denoDest)) {
    console.log(`Deno already present at ${denoDest}`)
    return
  }

  const asset = getDenoAssetName()
  const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`
  const zipPath = path.join(os.tmpdir(), `ytm-synk-${asset}`)

  console.log(`Downloading Deno from ${url}`)
  await download(url, zipPath)

  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${binDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'inherit' }
    )
  } else {
    execSync(`unzip -o "${zipPath}" -d "${binDir}"`, { stdio: 'inherit' })
    fs.chmodSync(denoDest, 0o755)
  }

  fs.unlinkSync(zipPath)
  console.log(`Saved Deno to ${denoDest}`)
}

async function main() {
  fs.mkdirSync(binDir, { recursive: true })

  console.log(`Downloading yt-dlp from ${YTDLP_URL}`)
  await download(YTDLP_URL, ytdlpPath)
  if (process.platform !== 'win32') {
    fs.chmodSync(ytdlpPath, 0o755)
  }
  console.log(`Saved yt-dlp to ${ytdlpPath}`)

  await copyFfmpeg()
  try {
    await downloadDeno()
  } catch (err) {
    console.warn('Deno download failed; yt-dlp will try to use Node.js if available.')
    console.warn(err instanceof Error ? err.message : err)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
