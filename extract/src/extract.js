/**
 * extract — the mechanical style-surface lift (brand-adoption end-to-end,
 * founder-ratified 2026-08-23; `npm create designless@latest -- extract`).
 *
 * THIN BY DESIGN (the annotate/serve SDK model): this walks the repo and LIFTS
 * raw style declarations into `.designless/style-surface.json` — syntactic
 * collection only, zero judgment. Which values are escapes, how they cluster,
 * what tokens they should become: all of that lives server-side behind the
 * wall (the extraction lint + the resolver). Same command for a static HTML
 * site and a Next.js/TS app; the LANE on each entry tells the server (and the
 * rewrite step) which syntax the value lives in.
 *
 * Zero dependencies. Deterministic: sorted file order, in-file line order,
 * same repo → same surface. Honest caps: hard entry/file limits with a
 * `truncated` marker — a partial surface never silently claims completeness.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT = 'extract/v1';
const MAX_FILES = 2000;
const MAX_ENTRIES = 20000;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.designless', '.vercel', 'coverage']);
const STYLE_EXTS = new Set(['.css', '.scss', '.less']);
const MARKUP_EXTS = new Set(['.html', '.htm', '.vue', '.svelte', '.astro']);
const CODE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

// Style-bearing CSS properties worth lifting (mechanical allowlist — the
// server's analyzer applies the real stylistic/structural split).
const PROP_RE = /^(color|background(?:-color|-image)?|border(?:-[a-z-]+)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|font(?:-family|-size|-weight)?|line-height|letter-spacing|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|border-radius|opacity|width|height|min-width|min-height|max-width|max-height|transition|animation(?:-[a-z]+)?)$/;

const DECL_RE = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
const CUSTOM_PROP_RE = /(--[a-zA-Z][\w-]*)\s*:\s*([^;{}]+);/g;
// Class lanes scan in TWO phases: find each class attribute, then scan its
// VALUE with the per-utility patterns. The first cut folded both into one
// regex anchored on `class=` — but /g resumes past the opening quote after a
// match, so only the FIRST utility per attribute was ever lifted. Measured in
// the adopt e2e (2026-08-26): `"... text-red-300 bg-red-950/30 ..."` reported
// text-red-300 and silently dropped bg-red-950/30, understating the
// hardcoded surface the zero-hardcoded claim is judged against.
const TW_ATTR_RE = /class(?:Name)?\s*=\s*["']([^"']*)["']/g;
const TW_ARBITRARY_INNER_RE = /[\w-]+-\[([^\]]+)\]/g;
// The optional /NN opacity modifier is part of the utility and is captured
// with it: `bg-red-500/15` is as hardcoded as `bg-red-500`, and the modifier
// is what the rewrite has to carry over.
const TW_CLASS_INNER_RE = /\b((?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d{1,3})?)(?![\w/])/g;
const JSX_STYLE_RE = /([a-zA-Z]+)\s*:\s*["'`]([^"'`]+)["'`]/g;

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (STYLE_EXTS.has(ext) || MARKUP_EXTS.has(ext) || CODE_EXTS.has(ext) || /^tailwind\.config\./.test(e.name)) out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

function liftCssText(entries, rel, text, startLine, lane) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    CUSTOM_PROP_RE.lastIndex = 0;
    while ((m = CUSTOM_PROP_RE.exec(line))) {
      entries.push({ lane: 'custom-prop', property: m[1], value: m[2].trim(), file: rel, line: startLine + i });
    }
    DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(line))) {
      const prop = m[1].toLowerCase();
      if (prop.startsWith('--') || !PROP_RE.test(prop)) continue;
      entries.push({ lane, property: prop, value: m[2].trim(), file: rel, line: startLine + i });
    }
  }
}

function liftFile(entries, root, abs) {
  const rel = path.relative(root, abs);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return; }
  const ext = path.extname(abs).toLowerCase();
  const base = path.basename(abs);

  if (/^tailwind\.config\./.test(base)) {
    // Thin lift: scalar color/px values out of the theme (the server judges).
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/["']?([\w-]+)["']?\s*:\s*["'](#[0-9a-fA-F]{3,8}|[\d.]+(?:px|rem))["']/);
      if (m) entries.push({ lane: 'tailwind-config', property: m[1], value: m[2], file: rel, line: i + 1 });
    }
    return;
  }

  if (STYLE_EXTS.has(ext)) { liftCssText(entries, rel, text, 1, 'css'); return; }

  if (MARKUP_EXTS.has(ext)) {
    // <style> bodies at their true line offsets, then class-attr lanes.
    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = styleRe.exec(text))) {
      const startLine = text.slice(0, m.index).split('\n').length;
      liftCssText(entries, rel, m[1], startLine, 'css');
    }
    liftClassLanes(entries, rel, text);
    // inline style="" attributes
    const inlineRe = /style\s*=\s*"([^"]+)"/g;
    while ((m = inlineRe.exec(text))) {
      const startLine = text.slice(0, m.index).split('\n').length;
      liftCssText(entries, rel, m[1] + ';', startLine, 'css');
    }
    return;
  }

  if (CODE_EXTS.has(ext)) {
    liftClassLanes(entries, rel, text);
    // JSX inline style objects: style={{ color: '#fff' }} — camelCase props
    // with literal string values on the same line (thin; dynamic expressions
    // are the server-reported unresolved lane by their absence).
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/style\s*=\s*\{\{/.test(lines[i])) continue;
      let m;
      JSX_STYLE_RE.lastIndex = 0;
      while ((m = JSX_STYLE_RE.exec(lines[i]))) {
        const cssProp = m[1].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        if (PROP_RE.test(cssProp)) entries.push({ lane: 'jsx-inline', property: cssProp, value: m[2].trim(), file: rel, line: i + 1 });
      }
    }
  }
}

function liftClassLanes(entries, rel, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let attr;
    TW_ATTR_RE.lastIndex = 0;
    while ((attr = TW_ATTR_RE.exec(lines[i]))) {
      const value = attr[1];
      let m;
      TW_ARBITRARY_INNER_RE.lastIndex = 0;
      while ((m = TW_ARBITRARY_INNER_RE.exec(value))) {
        entries.push({ lane: 'tailwind-arbitrary', property: 'class', value: m[1], file: rel, line: i + 1 });
      }
      TW_CLASS_INNER_RE.lastIndex = 0;
      while ((m = TW_CLASS_INNER_RE.exec(value))) {
        entries.push({ lane: 'tailwind-class', property: 'class', value: m[1], file: rel, line: i + 1 });
      }
    }
  }
}

/** Pure: lift the style surface of a repo root. */
function extractSurface(root) {
  const files = listFiles(root);
  const entries = [];
  for (const f of files) {
    if (entries.length >= MAX_ENTRIES) break;
    liftFile(entries, root, f);
  }
  const truncated = entries.length >= MAX_ENTRIES || files.length >= MAX_FILES;
  const lanes = {};
  for (const e of entries) lanes[e.lane] = (lanes[e.lane] || 0) + 1;
  return {
    contract: CONTRACT,
    root: path.basename(root),
    files_scanned: files.length,
    entry_count: entries.length,
    truncated,
    lanes,
    entries: entries.slice(0, MAX_ENTRIES),
  };
}

/**
 * Make `.designless/` ignore itself, before anything is written into it.
 *
 * Everything Designless writes here is local to one machine: a style surface
 * lifted from this checkout, and session state that includes a token. None of
 * it is meant to travel, and a token least of all, so the default has to be
 * that it cannot be committed by accident.
 *
 * The ignore file goes INSIDE the directory rather than into the repository's
 * own .gitignore, and the difference is the point. A repository's .gitignore is
 * a tracked file the developer owns; editing it without being asked is a change
 * to their project. A file inside a directory we just created is ours to write,
 * so this needs no prompt, no consent, and no cooperation from whatever tool
 * runs next. Git reads a .gitignore that its own `*` ignores, so one line covers
 * the directory and itself.
 *
 * It is written once. A developer who deliberately wants something here tracked
 * can `git add -f`, or edit this file, and a later run will not undo that.
 */
function ensureLocalOnly(dir) {
  const ignore = path.join(dir, '.gitignore');
  if (fs.existsSync(ignore)) return false;
  fs.writeFileSync(
    ignore,
    '# Local to this machine. Designless writes session state and extracted\n' +
    '# style surfaces here, and session state carries a token, so none of it\n' +
    '# should reach a remote. Track something here deliberately with: git add -f\n' +
    '*\n',
  );
  return true;
}

/** CLI runner: write .designless/style-surface.json (or stdout). */
function runExtract(cwd, { stdout = false } = {}) {
  const surface = extractSurface(cwd);
  const json = JSON.stringify(surface, null, 1);
  if (stdout) { process.stdout.write(json + '\n'); return surface; }
  const dir = path.join(cwd, '.designless');
  fs.mkdirSync(dir, { recursive: true });
  ensureLocalOnly(dir);
  fs.writeFileSync(path.join(dir, 'style-surface.json'), json);
  return surface;
}

module.exports = { extractSurface, runExtract, ensureLocalOnly, CONTRACT };
