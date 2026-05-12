# @translation-master/chrome

Chrome built-in Translator API adapter for `translation-master`.

This package downloads and reuses a managed Chrome for Testing build, launches it through `playwright-core`, opens a small bridge page, and delegates translation work to the browser's built-in `Translator` API.

## Install

```bash
pnpm add @translation-master/chrome
```

## Usage

```ts
import { ChromeTranslator } from '@translation-master/chrome'

const translator = new ChromeTranslator({
  onDownloadProgress(event) {
    console.log(event.state, event.progress, event.executablePath ?? event.cacheDir ?? '')
  },
})

const results = await translator.translate(['提交'], {
  sourceLocale: 'zh',
  targetLocale: 'en',
})

console.log(results[0]?.translation)
await translator.dispose()
```

## Notes

- Downloads Chrome for Testing into `.tmigrate/chrome` in the current project on first use and reuses it on later runs.
- Emits the cache directory and executable path through `onDownloadProgress` so users can inspect or delete the managed browser.
- Uses a real page click to initialize the translator because browser implementations may require user activation.
- Requests are serialized internally to reuse one browser page and one language-pair translator safely.
