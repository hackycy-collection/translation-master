import type { PluginOption, ResolvedConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { ensureTrailingSlash } from './utils'

export type VERSION = '3.18.66' | '4.0.3'

function createBundleFileName(assetsDir: string, version: VERSION): string {
  const timestamp = new Date().getTime().toString(16)
  const fileName = `translate-${version.replace(/\./g, '-')}-${timestamp}.js`

  return assetsDir ? `${assetsDir}/${fileName}` : fileName
}

async function readBundleSource(version: VERSION): Promise<string> {
  const bundleUrl = new URL(`../bundle/${version}/translate.js`, import.meta.url)

  try {
    return await readFile(bundleUrl, 'utf8')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read translate bundle for version "${version}": ${message}`)
  }
}

export interface PluginOptions {
  inject?: boolean
  version: VERSION
}

export function ViteTranslatePlugin(options: PluginOptions): PluginOption | undefined {
  const { inject = true, version } = options

  if (!inject) {
    return
  }

  let config: ResolvedConfig
  let emittedFileName = ''
  let publicPath = '/'
  let bundleSourcePromise: Promise<string> | undefined
  let isBundleEmitted = false

  function loadBundleSource(): Promise<string> {
    bundleSourcePromise ??= readBundleSource(version)
    return bundleSourcePromise
  }

  return {
    name: 'vite:translate',
    async configResolved(resolvedConfig) {
      config = resolvedConfig
      publicPath = ensureTrailingSlash(resolvedConfig.base)
      emittedFileName = createBundleFileName(resolvedConfig.build.assetsDir, version)
    },
    async generateBundle() {
      if (config.command !== 'build' || config.build.ssr || isBundleEmitted) {
        return
      }

      this.emitFile({
        type: 'asset',
        source: await loadBundleSource(),
        fileName: emittedFileName,
      })

      isBundleEmitted = true
    },
    async transformIndexHtml(html) {
      if (config.build.ssr) {
        return html
      }

      if (config.command === 'serve') {
        return {
          html,
          tags: [{ children: await loadBundleSource(), tag: 'script' }],
        }
      }

      const src = `${publicPath}${emittedFileName}`
      return {
        html,
        tags: [{ attrs: { src }, tag: 'script' }],
      }
    },
  }
}

export default ViteTranslatePlugin
