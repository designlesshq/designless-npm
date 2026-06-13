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

## Why these are public

`@designless/annotate` is the one piece of Designless that runs inside your build, so it is open by design: a single `grep` shows you exactly what it does (it stamps `data-source-*` attributes on host elements in development, and nothing else). You can read every line before you trust it.

Apache-2.0
