import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

export type Glossary = Record<string, string>

export async function loadGlossary(cwd = process.cwd()): Promise<Glossary> {
  return readJsonFile<Glossary>(path.join(cwd, '.tmigrate', 'glossary.json'), {})
}

export function matchGlossary(text: string, glossary: Glossary, filePath?: string): string | undefined {
  const contexts = filePath ? contextCandidates(filePath) : []

  for (const context of contexts) {
    const exact = glossary[`${context}/${text}`]
    if (exact)
      return exact
  }

  const plain = glossary[text]
  if (plain)
    return plain

  for (const context of contexts) {
    const prefix = glossary[`${context}/*`]
    if (prefix)
      return prefix
  }

  return undefined
}

function contextCandidates(filePath: string): string[] {
  const parts = toPosixPath(filePath).split('/').filter(Boolean)
  const basename = parts.at(-1)
  const withoutFile = basename && basename.includes('.') ? parts.slice(0, -1) : parts
  const candidates: string[] = []

  for (let index = withoutFile.length; index > 0; index--)
    candidates.push(withoutFile.slice(Math.max(0, index - 2), index).join('/'))

  return Array.from(new Set(candidates.filter(Boolean)))
}
