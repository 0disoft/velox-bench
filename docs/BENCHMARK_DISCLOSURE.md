# Benchmark Disclosure

- Velox currently has no immutable public alpha release. Its adapter is pinned
  to a source commit. A producer job compiles that exact commit outside the
  consumer timing boundary, matching Velox's prebuilt-host distribution model.
  This is not yet a release-vs-release comparison.
- Wails and Tauri compile application-specific native hosts. Neutralinojs and
  Velox acquire prebuilt native hosts. That architectural difference is part
  of end-to-end cold-build cost, not something removed from the measurement.
- All four use the operating-system WebView on Windows, but their runtime
  lifecycle and profile policies differ.
- Installer creation, code signing, frontend bundling, and external network
  access by the fixture are excluded.
- Startup comparison remains separate from cold-build comparison until every
  adapter exposes the same ready boundary.
- The immediate-relaunch control suite exposes one common ready boundary for
  Velox, a raw WebView2 host, Wails, and Neutralinojs, but it classifies lifecycle
  behavior rather than ranking product startup speed.
- Velox, the raw control, and Wails use explicit UDF paths. Neutralinojs reuses an
  isolated application directory with framework-managed profile placement, so
  a Neutralinojs difference cannot by itself prove a WebView2 controller cause.
- Velox uses a named-pipe ready marker while the other host bridges change the
  native title. Their small signaling overhead remains inside the measured
  boundary and is disclosed. The harness closes all four hosts externally.
- The current startup suite measures Velox only. It can detect Velox regressions
  and fresh-versus-settled-warm behavior, but it cannot support a claim that
  Velox starts faster than another framework.
- Velox raw startup v2 includes host-internal phase timing for diagnosis. Other
  adapters do not yet expose equivalent phases, so those values are not a
  cross-framework comparison surface.
- A ten-sample nearest-rank p95 equals the maximum observed sample. It preserves
  outliers but must not be presented as a stable long-term p95 estimate.
- Startup history retains bounded summary evidence and environment changes. It
  does not turn one- or three-sample diagnostics into publishable performance
  claims and does not automatically declare a regression.
- Acquisition working-set bytes are not network-transfer bytes. GitHub setup
  actions do not provide a stable network-byte counter.
- A one-sample workflow run proves only that the adapters and evidence pipeline
  execute. It cannot support a speed, cache, or winner claim.
