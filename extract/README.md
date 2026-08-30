# @designless/extract

Lifts a repo's style surface into one canonical file, so [Designless](https://designless.app) can adopt an existing codebase under a brand.

Adopting an app under a brand starts with a plain question: what style values does this code actually contain, and where? This package answers it mechanically. It walks the repo, lifts every style-bearing declaration with its `(file, line)`, and writes them to `.designless/style-surface.json`. That is all it does.

What it writes is local to your machine. On the first run it also puts a `.gitignore` inside `.designless/` containing a single `*`, so the directory ignores itself and nothing in it can be committed by accident. That matters because Designless keeps session state alongside the surface, and session state carries a token. The rule goes inside the directory rather than into your repo's own `.gitignore`, which is yours and is left alone. If you want something in there tracked deliberately, `git add -f` it or edit that file: it is written once and never rewritten.

## Use it

```bash
npx @designless/extract          # writes .designless/style-surface.json
npx @designless/extract --stdout # prints the surface instead
```

Or through the initializer, alongside the rest of the Designless setup:

```bash
npm create designless@latest -- extract
```

## What it lifts

Six lanes, because a value's syntax decides how it can later be rewritten:

| Lane | What it is |
|---|---|
| `css` | declarations in stylesheets, `<style>` bodies, and inline `style` attributes |
| `custom-prop` | custom-property declarations (`--brand: #FF6A00`) — usually where a palette really lives |
| `tailwind-arbitrary` | arbitrary values in classes (`bg-[#0f172a]`, `p-[13px]`) |
| `tailwind-class` | color and scale utility classes |
| `tailwind-config` | scalar theme values in `tailwind.config.*` |
| `jsx-inline` | literal values in JSX style objects |

Each entry carries `{ lane, property, value, file, line }`.

## What it does not do

It makes no judgments. It does not decide which values are wrong, what they should become, or how they cluster into a brand — that reasoning lives in Designless, not in your build. This package only reads and reports.

## Three guarantees

- **Read-only.** It writes two files, both inside `.designless/`, and nothing else in your
  project: the surface itself, and a `.gitignore` that makes that directory ignore itself.
  Your own `.gitignore` is never touched.
- **Deterministic.** The same repo produces the same surface, byte for byte.
- **Honest about limits.** Very large repos hit an entry cap; when that happens the output says `truncated: true` rather than quietly claiming to be complete.

No dependencies, no network, no telemetry.

## The same command everywhere

A static HTML site and a Next.js app go through the identical command. There is no framework detection, because there is nothing to detect: every lane is recognized by syntax.

---

Apache-2.0 · [designless.app](https://designless.app)
