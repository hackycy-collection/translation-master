import { defineConfig } from 'vite'
import TranslatePlugin from 'vite-plugin-translate'

export default defineConfig({
  base: './',
  server: {
    port: 8187,
  },
  plugins: [
    TranslatePlugin({
      inject: true,
      version: '3.18.66',
    }),
  ],
})
