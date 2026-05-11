import path from 'node:path'
import { glob } from 'tinyglobby'
import { mapPathToSourcePath, sourcePathToMapPath, toPosixPath } from './paths'

export async function findMapPaths(cwd: string, targetPath?: string): Promise<string[]> {
  const mapPaths = await glob('.tmigrate/maps/**/*.json', {
    cwd,
    absolute: false,
    onlyFiles: true,
  })

  const normalizedTarget = targetPath
    ? toPosixPath(path.relative(cwd, path.resolve(cwd, targetPath))).replace(/\/$/, '')
    : undefined

  return mapPaths
    .filter((mapPath) => {
      if (!normalizedTarget)
        return true

      const sourcePath = mapPathToSourcePath(mapPath)
      return sourcePath === normalizedTarget
        || sourcePath.startsWith(`${normalizedTarget}/`)
        || sourcePathToMapPath(sourcePath).startsWith(sourcePathToMapPath(normalizedTarget).replace(/\.json$/, '/'))
    })
    .sort()
}
