export function createUnifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after)
    return ''

  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const lines = [`--- ${filePath}`, `+++ ${filePath}`]
  const max = Math.max(beforeLines.length, afterLines.length)

  for (let index = 0; index < max; index++) {
    const beforeLine = beforeLines[index]
    const afterLine = afterLines[index]
    if (beforeLine === afterLine)
      continue
    if (beforeLine !== undefined)
      lines.push(`-${beforeLine}`)
    if (afterLine !== undefined)
      lines.push(`+${afterLine}`)
  }

  return `${lines.join('\n')}\n`
}
