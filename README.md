# Designless packages

[![@designless/annotate](https://img.shields.io/npm/v/%40designless%2Fannotate?label=%40designless%2Fannotate&color=0A0A0A)](https://www.npmjs.com/package/@designless/annotate)
[![create-designless](https://img.shields.io/npm/v/create-designless?label=create-designless&color=0A0A0A)](https://www.npmjs.com/package/create-designless)
[![@designless/web](https://img.shields.io/npm/v/%40designless%2Fweb?label=%40designless%2Fweb&color=0A0A0A)](https://www.npmjs.com/package/@designless/web)
[![@designless/react-native](https://img.shields.io/npm/v/%40designless%2Freact-native?label=%40designless%2Freact-native&color=0A0A0A)](https://www.npmjs.com/package/@designless/react-native)
[![CI](https://github.com/designlesshq/designless-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/designlesshq/designless-npm/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-0A0A0A)](LICENSE)

Open-source npm packages for connecting a project to [Designless](https://designless.app), where you edit your rendered UI and the edits route back to your source.

| Package | What it is |
|---------|------------|
| [`@designless/annotate`](./annotate) | Build-time source markers. The only Designless code that runs in your build: dev-only, zero network, byte-identical in production. |
| [`create-designless`](./create-designless) | One command to add and wire `@designless/annotate` into a Next.js or Vite-React project. |
| [`@designless/web`](./web) | Loads your brand on a page at runtime. A typed loader for the hosted script, with no brand data in the package. |
| [`@designless/react-native`](./react-native) | Loads your brand in a React Native app. Tokens, marks and fonts, with no brand data in the package. |

## Quick start

```bash
npm create designless@latest -- next     # or: vite
```

Then start your dev server and open the Designless canvas.

## What runs in your build

Only `@designless/annotate`, in development. It adds `data-source-*` attributes to host elements and does nothing else: no network calls, no change to production output.

## License

Apache-2.0. Copyright 2026 Designless Private Limited. [designless.io](https://designless.io)
