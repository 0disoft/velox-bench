# Methodology

## Scope

The first comparison targets Windows x64 and the dependency-free `hello`
fixture. Velox, Wails, Neutralinojs, and Tauri receive the same HTML, CSS, and
JavaScript bytes.

## Headline Boundary

End-to-end cold build starts after source checkout and immediately before the
first framework, toolchain, CLI, or release acquisition. It ends when a
portable, unsigned application archive is complete.

The boundary includes framework-specific setup actions, artifact downloads,
dependency resolution, native compilation, asset copying, and deterministic
ZIP packaging. It excludes repository checkout and Bun harness setup because
those are shared measurement infrastructure.

## Required Suites

- `zero-cache`: no GitHub Actions cache, package-manager cache restore, or
  compiler cache restore.
- `recommended-cache`: each framework's documented cache policy, reported
  separately from zero-cache.

## Repetitions

Pull requests validate contracts only. Scheduled and release-candidate runs
use ten isolated jobs per framework. Frameworks never execute sequentially in
one job. Manual runs default to one sample and are diagnostic only.

## Cache and Acquisition Evidence

The zero-cache workflow contains no `actions/cache` use and disables setup-go
caching. Its uploaded cache value is therefore a workflow-source contract, not
an estimate from local directories.

GitHub setup actions do not expose stable network-byte totals. Raw results do
not pretend otherwise. `acquisitionWorkingSetBytes` records the resulting
framework tool and cache directories; it is not labeled downloaded bytes.
Final archive bytes, portable output bytes, and surviving intermediate bytes
are measured separately.

## Failure Handling

The harness deadline is 40 minutes and precedes the 45-minute job timeout so a
timeout result can normally be written and uploaded. Runner loss or a setup
action that never returns can still prevent a raw file. The summary reports
expected, observed, and missing samples instead of silently dropping them.

## Publication Gate

Raw failures remain visible. A summary includes p50, p95, min, max, failure,
timeout, missing-sample, fixture, and framework-revision evidence. No result is
publishable until every adapter produces ten successful schema-valid raw
results from the same fixture digest and one pinned framework revision.
