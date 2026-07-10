import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getBundledBinDir } from './paths'

export interface JsRuntimeInfo {
  kind: 'deno' | 'node'
  path: string
}

let cachedRuntime: JsRuntimeInfo | null | undefined

function findExecutableOnPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const output = execSync(cmd, { encoding: 'utf-8', windowsHide: true }).trim()
    const first = output.split(/\r?\n/).find((line) => line.trim())
    if (first && existsSync(first)) return first
  } catch {
    // Not on PATH.
  }
  return null
}

export function resolveJsRuntime(): JsRuntimeInfo | null {
  if (cachedRuntime !== undefined) return cachedRuntime

  const binDir = getBundledBinDir()
  const denoName = process.platform === 'win32' ? 'deno.exe' : 'deno'
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'

  const bundledDeno = join(binDir, denoName)
  if (existsSync(bundledDeno)) {
    cachedRuntime = { kind: 'deno', path: bundledDeno }
    return cachedRuntime
  }

  const denoOnPath = findExecutableOnPath(denoName)
  if (denoOnPath) {
    cachedRuntime = { kind: 'deno', path: denoOnPath }
    return cachedRuntime
  }

  const bundledNode = join(binDir, nodeName)
  if (existsSync(bundledNode)) {
    cachedRuntime = { kind: 'node', path: bundledNode }
    return cachedRuntime
  }

  const nodeOnPath = findExecutableOnPath(nodeName)
  if (nodeOnPath) {
    cachedRuntime = { kind: 'node', path: nodeOnPath }
    return cachedRuntime
  }

  if (process.platform === 'win32') {
    const commonNodePaths = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe'
    ]
    for (const candidate of commonNodePaths) {
      if (existsSync(candidate)) {
        cachedRuntime = { kind: 'node', path: candidate }
        return cachedRuntime
      }
    }
  }

  cachedRuntime = null
  return cachedRuntime
}

export function resetJsRuntimeCache(): void {
  cachedRuntime = undefined
}
