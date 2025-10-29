// src/dev/dependencyGraph.ts
// Tracks file relationships and computes affected files for incremental rebuilds.

import { readFileSync, existsSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'

export type FilePath = string

export type DependencyGraph = {
  // file -> the files it depends on (children)
  dependencies: Map<FilePath, Set<FilePath>>
  // file -> the files that import it (parents)
  dependents: Map<FilePath, Set<FilePath>>
}

// ---------------- Core API ----------------

export function createDependencyGraph(): DependencyGraph {
  return {
    dependencies: new Map(),
    dependents: new Map(),
  }
}

// Extract import-like statements (ESM, export-from, dynamic import, CJS require)
// NOTE: No unnecessary escapes here.
const RE_IMPORT = /\bimport\s+(?:[^'"()]*?from\s*)?["']([^"']+)["']/g
const RE_EXPORT_FROM = /\bexport\s+[^;]*?from\s*["']([^"']+)["']/g
const RE_DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g
const RE_REQUIRE = /\brequire\(\s*["']([^"']+)["']\s*\)/g

// Extensions we attempt during resolution
const EXTENSIONS = ['.ts','.tsx','.js','.jsx','.vue','.svelte','.mjs','.cjs','.css','.scss','.html','.htmx']

// Parse a file to collect relative import specifiers
// Parse a file to collect relative import specifiers
export function extractDependencies(filePath: string): string[] {
  try {
    const code = readFileSync(filePath, 'utf8')
    const matches = new Set<string>()

    const collect = (re: RegExp) => {
      for (const m of code.matchAll(re)) {
        const s = m[1]
        if (typeof s === 'string') matches.add(s)
      }
    }

    collect(RE_IMPORT)
    collect(RE_EXPORT_FROM)
    collect(RE_DYNAMIC_IMPORT)
    collect(RE_REQUIRE)

    // Only keep relative/absolute paths; ignore bare package specifiers
    return Array.from(matches).filter(
      (s) => s.startsWith('./') || s.startsWith('../') || s.startsWith('/')
    )
  } catch {
    return []
  }
}



// Convert a relative import path to an absolute file path, trying common extensions and index.*
export function resolveImportPath(importPath: string, fromFile: string): string | null {
  const baseDir = dirname(fromFile)
  const candidate = importPath.startsWith('/') ? importPath : resolve(baseDir, importPath)

  if (existsSync(candidate) && !isDir(candidate)) return candidate

  for (const ext of EXTENSIONS) {
    const p1 = candidate + ext
    const p2 = join(candidate, 'index' + ext)
    if (existsSync(p1)) return p1
    if (existsSync(p2)) return p2
  }

  return null
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

// Add/refresh a file's edges in the graph
export function addFileToGraph(graph: DependencyGraph, filePath: string) {
  const deps = new Set<string>()
  for (const spec of extractDependencies(filePath)) {
    const resolved = resolveImportPath(spec, filePath)
    if (resolved) deps.add(resolved)
  }

  const prev = graph.dependencies.get(filePath) || new Set<string>()
  graph.dependencies.set(filePath, deps)

  // Remove stale reverse edges
  for (const d of prev) {
    if (!deps.has(d)) {
      const parents = graph.dependents.get(d)
      if (parents) {
        parents.delete(filePath)
        if (parents.size === 0) graph.dependents.delete(d)
      }
    }
  }

  // Add reverse edges
  for (const d of deps) {
    if (!graph.dependents.has(d)) graph.dependents.set(d, new Set<string>())
    graph.dependents.get(d)!.add(filePath)
  }
}

// Remove a file and clean up all edges
export function removeFileFromGraph(graph: DependencyGraph, filePath: string) {
  // outgoing
  const deps = graph.dependencies.get(filePath)
  if (deps) {
    for (const d of deps) {
      const parents = graph.dependents.get(d)
      if (parents) {
        parents.delete(filePath)
        if (parents.size === 0) graph.dependents.delete(d)
      }
    }
    graph.dependencies.delete(filePath)
  }

  // incoming
  const parents = graph.dependents.get(filePath)
  if (parents) {
    for (const p of parents) {
      const set = graph.dependencies.get(p)
      if (set) set.delete(filePath)
    }
    graph.dependents.delete(filePath)
  }
}

// Given a changed file, return every file affected (the file itself + all its dependents by BFS)
export function getAffectedFiles(graph: DependencyGraph, changedFile: string): string[] {
  const seen = new Set<string>([changedFile])
  const queue: string[] = [changedFile]

  while (queue.length) {
    const cur = queue.shift()!
    const parents = graph.dependents.get(cur)
    if (!parents) continue
    for (const p of parents) {
      if (!seen.has(p)) {
        seen.add(p)
        queue.push(p)
      }
    }
  }
  return Array.from(seen)
}
