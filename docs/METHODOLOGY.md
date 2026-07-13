# Methodology

## Scope

The first comparison targets Windows x64 and the dependency-free `hello`
fixture. Velox, Wails, and Neutralinojs receive the same HTML, CSS, and
JavaScript bytes.

## Headline Boundary

End-to-end cold build starts after source checkout and immediately before the
first framework, toolchain, CLI, or release acquisition. It ends when a
portable, unsigned application archive is complete.

The boundary includes downloads, dependency resolution, native compilation,
asset copying, and packaging. It excludes checkout because all frameworks use
the same checkout action.

## Required Suites

- `zero-cache`: no GitHub Actions cache, package-manager cache restore, or
  compiler cache restore.
- `recommended-cache`: each framework's documented cache policy, reported
  separately from zero-cache.

## Repetitions

Pull requests validate contracts only. Scheduled and release-candidate runs
use ten isolated jobs per framework. Frameworks never execute sequentially in
one job.

## Publication Gate

Raw failures remain visible. A summary must include p50, p95, min, max,
environment metadata, acquisition bytes, output bytes, surviving intermediate
bytes, and uploaded cache bytes. No result is publishable until every adapter
produces a schema-valid raw result from the same fixture digest and pinned
framework revision.

