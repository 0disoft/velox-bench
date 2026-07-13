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
- Acquisition working-set bytes are not network-transfer bytes. GitHub setup
  actions do not provide a stable network-byte counter.
- A one-sample workflow run proves only that the adapters and evidence pipeline
  execute. It cannot support a speed, cache, or winner claim.
