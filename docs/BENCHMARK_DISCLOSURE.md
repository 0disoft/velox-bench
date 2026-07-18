# Benchmark Disclosure

- Actutum currently has no immutable public alpha release. Its adapter is pinned
  to a source commit. A producer job compiles that exact commit outside the
  consumer timing boundary, matching Actutum's prebuilt-host distribution model.
  This is not yet a release-vs-release comparison.
- Wails and Tauri compile application-specific native hosts. Neutralinojs and
  Actutum acquire prebuilt native hosts. That architectural difference is part
  of end-to-end cold-build cost, not something removed from the measurement.
- All four use the operating-system WebView on Windows, but their runtime
  lifecycle and profile policies differ.
- Installer creation, code signing, frontend bundling, and external network
  access by the fixture are excluded.
- Startup comparison remains separate from cold-build comparison until every
  adapter exposes the same ready boundary.
- The immediate-relaunch control suite exposes one common ready boundary for
  Actutum, a raw WebView2 host, Wails, and Neutralinojs, but it classifies lifecycle
  behavior rather than ranking product startup speed.
- Actutum, the raw control, and Wails use explicit UDF paths. Neutralinojs reuses an
  isolated application directory with framework-managed profile placement, so
  a Neutralinojs difference cannot by itself prove a WebView2 controller cause.
- Actutum uses a named-pipe ready marker while the other host bridges change the
  native title. Their small signaling overhead remains inside the measured
  boundary and is disclosed. The harness closes all four hosts externally.
- The asset-transport suite is a cause-classification experiment, not a product
  ranking. Its three synthetic controls share one pinned Actutum fork and differ
  only in file URL, virtual-host mapping, or synchronous web-resource response
  delivery. The production Actutum row retains its named-pipe marker.
- Web-resource interception blocks a matching request until the synchronous
  handler returns. The fixture is tiny and frame-free; the result does not
  establish large-asset throughput, iframe behavior, or production hardening.
- The delay sweep reuses one runner for five delay cells to control hosted setup
  cost. Every cell has a separate UDF and order rotates by sample, but residual
  machine-wide WebView2 process state can still cross cell boundaries. The
  reported boundary is one of the five tested delays, not a continuous-time
  estimate or proof of an internal WebView2 timer.
- The recovery suite adds process and phase diagnostics, but its process handle
  observes only the main WebView2 browser process ID reported by the host. GPU,
  renderer, crashpad, and utility process lifetimes are not independently
  classified.
- Main browser exits not observed within 15 seconds are right-censored and
  counted, not treated as process leaks. `dominantRelaunchPhase` compares
  measured host intervals; it does not identify an internal Chromium lock or
  timer by itself.
- A fresh UDF changes process and storage ownership together. A fresh virtual
  hostname changes origin identity only in the synthetic virtual-host control.
  Neither scenario is a drop-in security-equivalent replacement for Actutum's
  production virtual HTTPS origin.
- Recovery jobs run six delay cells sequentially on one hosted runner. Delay
  order rotates by sample, but antivirus, runner scheduling, and machine-wide
  WebView2 state can still affect later cells. Only repeated complete evidence
  may support a boundary claim.
- The current startup suite measures Actutum only. It can detect Actutum regressions
  and fresh-versus-settled-warm behavior, but it cannot support a claim that
  Actutum starts faster than another framework.
- Actutum raw startup v3 includes host-internal phase timing for diagnosis. Other
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
- The zero-cache baseline fingerprint can reject a measurement runner before
  compiler or framework setup, but it cannot reserve a stable GitHub-hosted
  image. Summary v2 independently groups compatible environment tuples and blocks
  publication when they differ. Exact memory bytes and CPU model are disclosed but excluded from the
  blocking fingerprint because hosted VM memory reporting jitters and GitHub's standard runner pool mixes processor
  generations; an unbalanced per-framework CPU distribution still blocks the
  decision.
- The go-or-kill decision artifact applies only the numeric cache and
  Wails-to-Actutum cold-build gates. Structural simplicity, PWA differentiation,
  security review, and external user attempts remain separate product decisions.
- The `actutum-wails` scope intentionally omits Neutralinojs and Tauri to reduce
  runner cost while validating the product's numeric Wails comparison. It runs
  both frameworks on each runner and alternates execution order, so the pair
  shares CPU hardware but can still retain order, network, and hosted-runner
  noise. Its pair summary and decision use separate schema identifiers and must
  not be shown as an all-framework benchmark or winner table.
- Pair summary generation rejects matching sample IDs whose exact runner
  hardware differs or whose timing intervals overlap. This checks the paired
  workflow claim from raw evidence rather than trusting balanced CPU totals.
- The committed public result is generated from a pinned pair summary, pair
  decision, and normalized GitHub run metadata. The README block is a derived
  view and cannot be edited independently without failing the contract check.
- Workflow wall time and aggregate job runtime use GitHub API wall-clock
  timestamps. They are not billed Actions minutes, and summed job runtime
  intentionally counts intervals that overlap in parallel.
- Artifact count and bytes describe the GitHub API response at metadata capture
  time. Retention expiry can later change remote availability without changing
  the preserved publication evidence.
- The deterministic asset-pack generator has a pinned 1,000-file, 10 MiB tree
  contract and is available to manual hosted all-framework diagnostics. Fixture
  generation happens before the clock; adapter materialization happens inside
  it. A one-sample run proves workflow integration only. The published table
  still uses `hello`, and no asset-pack winner claim exists.
- Actutum already emits its declared portable ZIP during `actutum build`; result v3
  reuses that archive. Its packaging cost is included in `buildMs`, while
  harness `packageMs` is zero. Re-zipping it would add duplicate work and report
  a valid product output as a surviving intermediate.
- Recommended-cache results are not zero-cache publication inputs. They use
  explicit cache paths equivalent to the documented Go, npm, and Cargo cache
  surfaces so save and restore can be measured directly; they do not reproduce
  every third-party wrapper action's cleanup heuristics.
- GitHub API `size_in_bytes` is the stored cache archive size. Cache working-set
  bytes are measured separately and may be larger. Restore duration includes
  the cache action but not repository checkout or Bun harness setup.
- Every recommended-cache key contains the run ID and attempt. The cleanup job
  deletes those exact keys after evidence upload. Cleanup failure can
  temporarily leave quota-consuming entries and must be reported.
- A one- or three-sample recommended-cache summary is operational evidence,
  not a framework winner table. The v1 contract keeps
  `comparativeClaimAllowed` false.
