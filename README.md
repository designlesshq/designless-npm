# Designless packages

Open-source npm packages for connecting a project to [Designless](https://designless.app), where you edit your rendered UI and the edits route back to your source.

| Package | What it is |
|---------|------------|
| [`@designless/annotate`](./annotate) | Build-time source markers. The only Designless code that runs in your build: dev-only, zero network, byte-identical in production. |
| [`create-designless`](./create-designless) | One command to add and wire `@designless/annotate` into a Next.js or Vite-React project. |

## Quick start

```bash
npm create designless@latest -- next     # or: vite
```

Then start your dev server and open the Designless canvas.

## What runs in your build

Only `@designless/annotate`, in development. It adds `data-source-*` attributes to host elements and does nothing else: no network calls, no change to production output.

Apache-2.0
