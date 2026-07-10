const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

export function sanitizeFileName(name: string): string {
  return name.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim()
}

export function extractVideoIdFromFileName(fileName: string): string | null {
  const bracketMatch = fileName.match(/ \[([^\]]+)\]\.mp3$/i)
  if (bracketMatch?.[1]) return bracketMatch[1]

  const parenMatch = fileName.match(/ \(([^)]+)\)\.mp3$/i)
  if (parenMatch?.[1]) return parenMatch[1]

  return null
}

export function buildTrackFileName(artist: string, title: string, videoId: string): string {
  const base = sanitizeFileName(`${artist} - ${title}`) || 'Track'
  return sanitizeFileName(`${base} [${videoId}].mp3`)
}

export function resolveUniqueFileName(
  folder: string,
  desiredName: string,
  videoId: string,
  exists: (path: string) => boolean,
  joinPath: (...parts: string[]) => string
): string {
  const fullPath = joinPath(folder, desiredName)
  if (!exists(fullPath)) return desiredName

  const ext = '.mp3'
  const base = desiredName.endsWith(ext) ? desiredName.slice(0, -ext.length) : desiredName
  const withId = sanitizeFileName(`${base} (${videoId})${ext}`)
  if (!exists(joinPath(folder, withId))) return withId

  let counter = 2
  while (exists(joinPath(folder, sanitizeFileName(`${base} (${videoId}) ${counter}${ext}`)))) {
    counter++
  }
  return sanitizeFileName(`${base} (${videoId}) ${counter}${ext}`)
}
