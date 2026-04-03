import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/helper.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  exports: true,
  publint: true,
})
