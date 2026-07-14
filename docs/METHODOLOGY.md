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
one job. Manual runs can select all frameworks or one framework and can request
one, three, or ten samples. One- and three-sample runs are diagnostic only.
Targeted runs retain raw evidence without generating a misleading
cross-framework summary. A non-Velox targeted run also skips the Velox producer
job.

## Velox Startup Measurement

Startup is a separate manual suite and does not alter cold-build timing. The
ready boundary starts immediately before creating the packaged host process and
ends when the fixture reports `DOMContentLoaded` followed by two animation
frames over Velox's benchmark-only named pipe.

`velox.startup-benchmark/v2` also records a process-local monotonic host
timeline. Successful launches must contain exactly this order:

1. host entry and configuration load;
2. runtime open and native window creation;
3. WebView2 environment and controller creation;
4. WebView creation and navigation dispatch;
5. runtime open completion and the DOM-plus-two-animation-frame marker.

The host timeline diagnoses where a process-to-ready outlier occurred. It does
not replace the parent harness clock used for the headline ready duration.

Each isolated sample records two profiles:

- `fresh` uses a new WebView2 user-data folder;
- `warm` reuses one folder after five unrecorded, settled warmups.

After every launch, the harness waits for the browser process ID carried by the
ready marker to exit. It then proves profile release by renaming the user-data
folder away and back. The next launch does not begin until both checks pass.
This excludes immediate same-profile relaunch contention from the settled warm
profile while preserving browser-exit and profile-release durations as raw
diagnostics.

One and three samples validate the measurement path only. Publication requires
ten successful isolated samples and one exact runner-image, Windows, and
WebView2 environment group. CPU and memory remain raw diagnostic metadata but
do not split hosted-runner series. Hosted jobs label evidence as
`hosted-pinned-source` only after checking out the exact Velox revision. Local
smoke results use `local-unverified-release` and are never publishable.
Statistics use nearest-rank percentiles. With exactly ten samples, p95 is the
maximum observed value, so it is a disclosed tail observation rather than a
stable estimate of the population p95.

## Startup History

Every successful startup summary is followed by a history collection job. It
uses GitHub Actions read-only access to download the current summary and up to
eleven prior successful manual-run summaries. The history retains at most
twelve points, keeps the newest attempt for a repeated run, and groups points
by runner image version, Windows version, and WebView2 version. Legacy keys
that also contain CPU and memory fields are normalized to those first three
fields.

An expired, missing, or invalid summary is a collection issue. It is not
silently removed and changes the history outcome from `complete` to `partial`.
History does not compare points across environment series and does not enforce
a regression threshold.

## Cache and Acquisition Evidence

The zero-cache workflow contains no `actions/cache` use. It disables Bun
executable caching, setup-go module and build caching, and setup-node automatic
package-manager caching. Its uploaded cache value is therefore a
workflow-source contract, not an estimate from local directories.

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
