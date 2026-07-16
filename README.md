# Velox Bench

Public benchmark contracts and fixtures for Velox, Wails, Neutralinojs, and
Tauri.

The zero-cache hosted workflow, versioned raw-result contract, failure-preserving
summary, and byte-identical adapters are implemented. This repository still
publishes no performance table: a manual one-sample run validates plumbing,
while publication requires ten complete isolated samples per framework.

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
and proves that every adapter's HTML, CSS, and JavaScript fixture matches the
canonical fixture byte for byte.

## Hosted Suites

Pull requests and ordinary main pushes run contract checks only. A manual run
can target one framework or all four with one, three, or ten isolated samples.
Targeted runs upload raw evidence only; all-framework runs also upload a
summary. Weekly and `benchmark-v*` tag runs execute ten isolated samples per
framework. Raw results remain available when an individual measurement reports
failure.

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
