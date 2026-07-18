# Velox Bench

Public benchmark contracts and fixtures for Velox, Wails, Neutralinojs, and
Tauri.

The zero-cache hosted workflow, versioned raw-result contract,
failure-preserving summary, environment-consistency gate, machine-derived
go-or-kill decision, byte-identical adapters, and machine-generated public
result publication, deterministic asset-pack contract, hosted asset-pack
diagnostic path, and a quota-cleaning recommended-cache workflow are
implemented. The published pair result does not claim a four-framework winner.
Asset-pack and recommended-cache evidence remain separate from the zero-cache
publication.

## Published Velox-Wails Result

<!-- BEGIN GENERATED VELOX-WAILS RESULT -->

Source: [GitHub Actions run 29569560999](https://github.com/0disoft/velox-bench/actions/runs/29569560999) at benchmark revision `0f83ff4156441044fa0c2290e8fe266d0d5fcb86`.
This block is generated from the committed publication contract. Do not edit its values by hand.

| Framework | Successful samples | End-to-end p50 | End-to-end p95 |
| --- | ---: | ---: | ---: |
| Velox | 10 | 1,997 ms | 2,844 ms |
| Wails | 10 | 72,140 ms | 124,112 ms |

Wails-to-Velox p50 ratio: **36.124x**. Uploaded Actions cache: **0 B**.

### CI Resource Observation

| Observation | Value |
| --- | ---: |
| Workflow wall time | 331.000 s |
| Aggregate observed job runtime | 1233.000 s |
| Jobs | 15 observed / 14 successful / 1 skipped / 0 failed |
| Artifacts at capture | 13 / 3,207,423 B |
| Expired artifacts at capture | 0 |

Workflow wall time and aggregate job runtime come from GitHub's wall-clock timestamps. They are observations, not billed Actions minutes. Artifact bytes are the API-reported sizes at capture time.

<!-- END GENERATED VELOX-WAILS RESULT -->

## Current Pins

- Velox: commit `ae7a819f0ef9b22cb4f959451d0189d699c6e546`
- Raw WebView2 control binding: commit `56598839c808a2340edee99204db479f410e9bf4`
- Wails: `v2.13.0`
- Neutralinojs core: `v6.8.0`
- Neutralinojs CLI: `v11.7.2`
- Tauri: `v2.11.2`
- Runner: `windows-2025`

## Local Contract Check

```text
bun run check
```

The check compiles the TypeScript harness, runs contract and deterministic ZIP
tests, validates immutable framework and Action pins, rejects cache actions,
proves that every adapter's HTML, CSS, and JavaScript fixture matches the
canonical fixture byte for byte, and regenerates the publication contract and
README block in memory to reject hand-edited numbers.

## Deterministic Asset Pack

The asset-pack manifest describes exactly 1,000 generated files totaling
10 MiB. The dependency-free generator derives every path and byte from the
pinned seed, refuses an existing destination, verifies the materialized tree,
and keeps generated payloads out of Git.

```text
bun scripts/generate-asset-pack.ts .bench/fixtures/asset-pack --json
```

`bench.lock.json` pins the expected tree digest. `bun run check` computes the
full 10 MiB contract in memory, while unit tests materialize smaller trees to
exercise filesystem behavior. A manual hosted run can select `asset-pack`; the
workflow generates it before the benchmark clock, then measures copying the
generated tree into each framework adapter. Raw result v2 and all-framework
summary v3 identify the selected fixture by name, digest, file count, and byte
count. One-sample asset-pack runs are diagnostics, not winner evidence.

## Hosted Suites

Pull requests and ordinary main pushes run contract checks only. A manual run
can target one framework, the `velox-wails` product gate, or all four with one,
three, or ten isolated samples and can select `hello` or `asset-pack`.
Single-framework runs upload raw evidence only. The publication-bound
`velox-wails` scope remains `hello`-only.
The pair scope uses ten paired runner jobs. Each job measures Velox and Wails on
the same machine, with five samples in each execution order, and uploads a
dedicated pair summary and decision without scheduling Neutralinojs or Tauri.
All-framework runs retain their existing summary and go-or-kill artifact. A cheap baseline job records
the runner image, Windows version, logical processor count, and nearest-GiB memory class before
measurement. Every measurement job must match that fingerprint
before framework toolchain setup starts. Weekly and `benchmark-v*` tag runs execute ten isolated samples per
framework. Raw results remain available when an individual measurement reports
failure.

## Recommended-Cache Suite

The manual `Recommended-cache benchmark` workflow runs prime and warm phases on
different Windows runners. Velox remains cache-free. Wails saves its Go module
and build caches, Neutralinojs saves the npm download cache, and Tauri saves its
Cargo home and target tree. Explicit restore and save steps make restore time,
save time, and the GitHub API `size_in_bytes` value part of the result contract
instead of inferring an archive size from a local directory.

Every framework and sample receives a run-owned exact cache key. Prime must
miss, warm must hit, and an always-running cleanup job deletes those exact keys
after summary generation. The workflow is manual or benchmark-tag-only so it
does not fill cache storage on pull requests or a schedule. One or three
samples can establish that the path works, but the v1 summary keeps
`comparativeClaimAllowed` false and cannot replace the zero-cache headline.

All-framework summary v3 preserves explicit fixture identity and every observed
compatible environment tuple and refuses publication
when more than one tuple is present. Exact memory bytes and CPU models remain recorded separately;
their per-framework sample counts must be balanced even though normal hosted
CPU variation does not fail the preflight. A three-sample decision can be `promising`,
`below-target`, or `insufficient-evidence`; only a complete ten-sample summary
can produce a publishable `passed` or `failed` decision. The speed gate is the
pinned Wails p50 divided by the Velox p50, with a required minimum of `3`.
The pair contract applies the same sample-completeness, environment, CPU-balance,
and zero-cache gates to Velox and Wails only. Same-runner pairing makes every
observed CPU model contribute once to each framework. Passing it proves the numeric
product gate, not a four-framework winner claim.

## Velox Startup Suite

The manual `Velox startup benchmark` workflow measures only Velox. Each
isolated sample records process-to-ready startup with a new WebView2 user-data
folder and again after five settled warmups on one reused folder. The harness
waits for the reported WebView2 browser process to exit and for the user-data
folder lock to clear between launches, so warm startup is not confused with an
immediate relaunch handoff. One- and three-sample runs are diagnostic. Ten
complete samples from one runner and WebView2 environment are required before
the summary is publishable. Raw v2 results also retain the benchmark-only host
timeline from host entry through WebView2 environment and controller creation,
navigation dispatch, and the DOM-plus-two-animation-frame boundary.

After a successful summary, the workflow collects up to twelve recent startup
summary artifacts into `velox.startup-history/v1`. Environment changes create
separate series, and missing or invalid artifacts remain visible as collection
issues. History is diagnostic evidence, not an automatic regression verdict.

## Immediate Relaunch Controls

The manual `Immediate relaunch controls` workflow runs Velox, a raw WebView2
host, Wails, and Neutralinojs in isolated jobs. Each sample closes the first
host and starts the second host immediately against the same profile boundary.
Velox, the raw control, and Wails receive an explicit UDF path. Neutralinojs
reuses one isolated application directory and its framework-managed profile;
the weaker control is recorded in every result.

All adapters use the same `DOMContentLoaded` plus two-animation-frame marker.
Velox reports it through the existing benchmark named pipe; the other hosts
change their native window title. A Windows harness observes either signal,
closes the window externally, and starts the immediate launch. Three samples
classify the likely lifecycle owner; ten complete samples are required before
the summary is publishable.

## Asset Transport Controls

The manual `Asset transport relaunch controls` workflow isolates asset loading
from the rest of the host. Three controls use the same pinned Velox WebView2
fork and host code with only `file://`, virtual-host folder mapping, or
`WebResourceRequested` response handling changed. A fourth row runs Velox's
production virtual-host path. All four reuse an explicit UDF and the same
external-close harness. Ten samples per transport are required for a
publishable cause-classification result.

The manual `Asset transport relaunch delay sweep` workflow follows that result
with requested delays of 0, 100, 250, 500, and 1,000 ms. One runner measures
all five delays for one transport/sample pair, rotates their order by sample,
and assigns a separate UDF to every delay. This keeps the hosted job count at
four transports times the requested sample count instead of multiplying it by
five. Ten complete samples per transport and delay are required for a
publishable recovery-boundary result.

The manual `Asset transport recovery diagnostics` workflow extends the search
to 0, 1, 2, 4, 6, and 7 seconds. It compares same-profile and fresh-profile
relaunches for Velox, file URL, and virtual-host mapping, plus a virtual-host
control that changes only the second launch origin. Each successful result
includes host and browser process IDs, browser-exit timing, and the WebView2
environment, controller, navigation, ready, and shutdown phase timelines.
Browser-exit observation is bounded at 15 seconds and failed observations fail
the sample. The summary counts censored exits and names the p50-dominant
relaunch phase across environment creation, controller creation, and the
remaining controller-to-ready path.
Three samples diagnose the boundary; ten complete samples are required before
the summary is publishable.
