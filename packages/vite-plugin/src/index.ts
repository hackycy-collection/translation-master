import type { HtmlTagDescriptor, PluginOption, ResolvedConfig } from 'vite'
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

function createScriptTags(options: {
  script?: { children: string } | { src: string }
  initializeScript?: string
}): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = []

  if (options.script) {
    if ('children' in options.script) {
      tags.push({ children: options.script.children, tag: 'script' })
    }
    else {
      tags.push({ attrs: { src: options.script.src }, tag: 'script' })
    }
  }

  if (options.initializeScript?.trim()) {
    tags.push({ children: options.initializeScript, tag: 'script' })
  }

  return tags
}

export interface PluginOptions {
  /**
   * @description: 是否自动注入translate.js脚本到html中，默认为true
   */
  inject?: boolean

  /**
   * @description: translate.js版本，必填项
   */
  version: VERSION

  /**
   * @description: 在 translate.js 加载并执行后注入执行的初始化脚本
   */
  initializeScript?: string
}

export function ViteTranslatePlugin(options: PluginOptions): PluginOption | undefined {
  const { inject = true, version, initializeScript } = options

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
          tags: createScriptTags({
            script: { children: await loadBundleSource() },
            initializeScript,
          }),
        }
      }

      const src = `${publicPath}${emittedFileName}`
      return {
        html,
        tags: createScriptTags({
          script: { src },
          initializeScript,
        }),
      }
    },
  }
}

export default ViteTranslatePlugin
