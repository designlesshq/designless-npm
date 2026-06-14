// The SWC engine tests (swc.test.js, and next.test.js's real-transform path)
// make @swc/core compile the wasm plugin into a shared .swc cache on first use.
// Default vitest runs test FILES in parallel, so two files race that one-time
// compilation — which surfaces intermittently in CI as
// `Failed to compile wasm plugins … index not found` (a half-written cache
// entry). The whole suite runs in well under a second, so serialize the files:
// the plugin then compiles exactly once, in order, with no cache contention.
export default {
  test: { fileParallelism: false },
}
