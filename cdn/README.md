# CDN artifacts

Static files served from `cdn.designless.app`. These are **not** part of any npm package; they are published to the CDN separately. The directory layout mirrors the served URL path.

## `annotate/capabilities.v1.json`

Served at: **https://cdn.designless.app/annotate/capabilities.v1.json**

The framework-support manifest for [`create-designless`](../create-designless). The initializer ships with a built-in baseline (so it works offline) and optionally fetches this file, merging it over the baseline. That lets new framework support or a wiring change reach users **without an npm release**.

This file is the canonical source. The npm package's baked-in baseline mirrors it; a test pins them in sync (no drift).

It is inert public data: a `framework → wiring` map. No secrets, no engine details.

### How it is served

Exactly like the fonts: a host-scoped Vercel rewrite on `cdn.designless.app` maps the path to a public Supabase Storage bucket.

- Rewrite (in the `designsystem` repo `vercel.json`): `/annotate/:path*` → the `annotate` public Storage bucket.
- Bucket: `annotate` (public, `application/json`/`text/plain`, 1 MB cap) — created by `designsystem` migration `20260614100000_annotate_public_bucket.sql`.

No edge function and no server logic: the CDN is purely the serve mechanism for a static file.

### How to publish (after editing this file)

Upload the file to the `annotate` bucket. One-off, with the Supabase CLI (needs project access):

```bash
supabase storage cp cdn/annotate/capabilities.v1.json \
  ss:///annotate/capabilities.v1.json \
  --project-ref mjvbhqaqiqfgxgzicrao --experimental
```

Recommended for the long run: a CI publish step (GitHub Action) that uploads this file to the bucket whenever it changes on `main`, using a `SUPABASE_SERVICE_KEY` repo secret. Then editing the JSON in a PR is the whole update flow.

### Is this needed in the `designless-agent` plugin?

**No.** This manifest is for the standalone npm initializer only. The coding-agent path (the `/designless` plugin → prism-agent driving page-mode setup) reads the same `framework → command` authority over the **authenticated MCP wire**, not from this static CDN file. The two are independent read paths of the same underlying data on two transports:

| Consumer | Transport | This file? |
|----------|-----------|------------|
| `create-designless` (npm initializer, on the user's machine) | HTTPS GET from the CDN | yes |
| coding agent (prism-agent) | authenticated MCP wire | no — via MCP |

The CDN never carries agent tooling; it only serves static content.
