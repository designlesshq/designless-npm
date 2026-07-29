# @designless/web

Load your brand on any site with one call. This package adds the
`designless.js` script tag for you and hands back a typed handle once the
script is ready.

## Install

```sh
npm install @designless/web
```

## Use

```ts
import { loadDesignless } from "@designless/web";

const designless = await loadDesignless({ publicId: "r_XXX" });
const tokens = await designless.tokens();
```

The script tag is added once, no matter how many times you call
`loadDesignless`. If the page already has the tag, this package reuses it.
A failed load rejects with a clear error, and a later call tries again.

## Options

- `publicId` (required). The public id of your brand.
- `key` (optional). Passed to the script as `data-key`. Reserved for a
  future publishable key.
- `scriptUrl` (optional). Where to load the script from. The default is
  `https://cdn.designless.app/designless.js`, which always serves the
  latest version. To stay on the v1 line, set it to
  `https://cdn.designless.app/designless/v1.js`.

## API

The resolved handle is the same object the script places on
`window.designless`:

- `tokens()` promise of the brand token tree, cached in memory
- `asset(role, { format, appearance })` URL for a brand asset such as
  `"logo-symbol"`; `format` is `"svg"` or `"png"`, `appearance` is
  `"light"` or `"dark"`
- `subscribe(cb)` calls `cb` with `{ hash, semver }` when the brand updates
- `unsubscribe()` stops updates and clears every subscriber
- `version` the `{ hash, semver }` of the loaded brand, or `null` before
  the first response
- `load({ publicId, key })` switches to another brand

## Server rendering

Importing this package on the server is safe. There, `loadDesignless`
resolves to a placeholder, and only calling one of its methods raises a
clear error. Keep brand calls in browser code, such as a client component
or an effect.
