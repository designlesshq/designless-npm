# @designless/annotate

Build-time source markers so [Designless](https://designless.app) can route a rendered element back to its exact source line.

When you edit a rendered element on the Designless canvas, the edit needs to find its way home: to the `(file, line)` that produced it. This package stamps that provenance onto your host elements during development, as plain data attributes. That is all it does.

## What it stamps

On each intrinsic host element (`div`, `h1`, `button`, custom elements), in development only:

```html
<h1 data-source-file="src/page.tsx" data-source-line="12" data-selectable data-designless="annotate/v1">
```

- `data-source-file`: repo-relative path (never absolute, never `..`)
- `data-source-line`: the element's source line
- `data-selectable`: marks it selectable on the canvas (your own `data-selectable` is left untouched)
- `data-designless`: the marker contract version

Components are skipped. Already-marked elements are skipped. That is the whole contract, and it is frozen at `annotate/v1`.

## Two guarantees

- **Production is untouched.** Markers are stamped in development only. Your production build is byte-for-byte what it would be without this package.
- **It cannot break your build.** A marker it cannot produce is simply not produced. No code path here stops `next dev` or `vite` from starting.

## Install

The one-liner does it for you:

```bash
npm create designless@latest -- next   # or: vite
```

Or wire it yourself.

**Next.js** (`next.config.js`), using the bundled SWC plugin (works under Turbopack):

```js
const { withDesignless } = require('@designless/annotate/next')
module.exports = withDesignless({ /* your config */ })
```

**Vite + React** (`vite.config.js`):

```js
import react from '@vitejs/plugin-react'
export default { plugins: [react({ babel: { plugins: ['@designless/annotate/babel'] } })] }
```

## Scope

Development only. No network calls on any build path, no configuration, no change to production output. The package adds the marker attributes described above and nothing else.

Apache-2.0 · [designless.app](https://designless.app)
