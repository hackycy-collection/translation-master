# vite-plugin-translate

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]

Vite plugin for [translate.js](https://github.com/xnx3/translate)

## Install

``` bash
pnpm add -D vite-plugin-translate
```

## Usage

```ts
import { defineConfig } from 'vite'
import { ViteTranslatePlugin } from 'vite-plugin-translate'

export default defineConfig({
  plugins: [
    ViteTranslatePlugin({
      version: '4.0.3',
      initializeScript: `
        translate.language.setLocal('english');
        translate.execute();
      `,
    }),
  ],
})
```

`ViteTranslatePlugin` will read `bundle/<version>/translate.js` from the installed package, emit it to the build output with a version and timestamp in the file name, and inject the script tag into HTML automatically.

When `initializeScript` is provided, the plugin injects it as a second script tag after `translate.js`, so the initialization code runs only after `translate.js` has been loaded and executed.

Supported versions: `3.18.66`, `4.0.3`.

## License

[MIT](./LICENSE) License © [hackycy](https://github.com/hackycy)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/vite-plugin-translate?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/vite-plugin-translate
[npm-downloads-src]: https://img.shields.io/npm/dm/vite-plugin-translate?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/vite-plugin-translate
