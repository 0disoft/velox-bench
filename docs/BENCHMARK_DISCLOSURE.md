# Benchmark Disclosure

- Velox currently has no immutable public alpha release. Its adapter is pinned
  to a source commit and cannot yet produce a publishable release-vs-release
  comparison.
- Wails compiles an application-specific Go host. Neutralinojs acquires a
  prebuilt native host. That architectural difference is part of end-to-end
  cold-build cost, not something removed from the measurement.
- All three use the operating-system WebView on Windows, but their runtime
  lifecycle and profile policies differ.
- Installer creation, code signing, frontend bundling, and external network
  access by the fixture are excluded.
- Startup comparison remains separate from cold-build comparison until every
  adapter exposes the same ready boundary.

