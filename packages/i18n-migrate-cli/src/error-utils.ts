export function toError(error: unknown): Error {
  if (error instanceof Error)
    return error
  return new Error(typeof error === 'string' ? error : JSON.stringify(error))
}

export function formatErrorWithCauses(error: unknown): string {
  const root = toError(error)
  const lines: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = root
  let depth = 0

  while (current && !seen.has(current)) {
    seen.add(current)
    lines.push(`${depth === 0 ? '' : 'Caused by: '}${formatSingleError(current)}`)
    current = getCause(current)
    depth++
  }

  return lines.join('\n')
}

function formatSingleError(error: unknown): string {
  if (!(error instanceof Error))
    return String(error)

  const name = error.name && error.name !== 'Error' ? `${error.name}: ` : ''
  const message = error.message || 'Unknown error'
  const metadata = getErrorMetadata(error)
  return metadata ? `${name}${message} (${metadata})` : `${name}${message}`
}

function getCause(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !(('cause' in error)))
    return undefined
  return (error as { cause?: unknown }).cause
}

function getErrorMetadata(error: Error): string {
  const fields: string[] = []
  const record = error as Error & {
    code?: unknown
    errno?: unknown
    syscall?: unknown
    hostname?: unknown
    address?: unknown
    port?: unknown
    url?: unknown
  }

  if (typeof record.code === 'string' && record.code !== '')
    fields.push(`code=${record.code}`)
  if (typeof record.errno === 'number' || typeof record.errno === 'string')
    fields.push(`errno=${record.errno}`)
  if (typeof record.syscall === 'string' && record.syscall !== '')
    fields.push(`syscall=${record.syscall}`)
  if (typeof record.hostname === 'string' && record.hostname !== '')
    fields.push(`hostname=${record.hostname}`)
  if (typeof record.address === 'string' && record.address !== '')
    fields.push(`address=${record.address}`)
  if (typeof record.port === 'number' || typeof record.port === 'string')
    fields.push(`port=${record.port}`)
  if (typeof record.url === 'string' && record.url !== '')
    fields.push(`url=${record.url}`)

  return fields.join(', ')
}
