# create-designless

Connect a Next.js or Vite-React project to [Designless](https://designless.app) in one command.

```bash
npm create designless@latest -- next     # or: vite
```

It does exactly two things, and tells you about both:

1. Adds [`@designless/annotate`](https://www.npmjs.com/package/@designless/annotate) as a devDependency.
2. Wires it into your config (wraps `next.config.js`, or shows you the two-line Vite snippet).

Then it runs a doctor and reports what it found, so you never have to wonder whether it worked.

## Flags

- `<framework>`: `next` or `vite` (with aliases). Omit it and the project is detected from your config and dependencies.
- `--yes`: apply the changes (install and wire) instead of just printing the plan.
- `--dry-run`: print the plan and change nothing.

## Reversible and honest

It never runs a build, never touches your source, and never edits a config it does not fully understand. If your config has an unusual shape, it prints exact copy-paste instructions instead of guessing. The only files it changes are `package.json` (one devDependency) and your framework config (one wrap). Both are easy to undo.

After it finishes, start your dev server and open the Designless canvas. Edits you make there route back to your source.

Apache-2.0 · [designless.app](https://designless.app)
