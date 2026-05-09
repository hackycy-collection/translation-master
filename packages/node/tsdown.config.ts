import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  exports: true,
  publint: true,
  external: ['@huggingface/transformers', '@translation-master/core', 'node:fs', 'node:path', 'node:crypto'],
})
