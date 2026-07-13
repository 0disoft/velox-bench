# Velox Bench

Public benchmark contracts and fixtures for Velox, Wails, Neutralinojs, and
Tauri.

The zero-cache hosted workflow, versioned raw-result contract, failure-preserving
summary, and byte-identical adapters are implemented. This repository still
publishes no performance table: a manual one-sample run validates plumbing,
while publication requires ten complete isolated samples per framework.

## Current Pins

- Velox: commit `64ee93a26eef65e4216095f546f1ed74d5232ee9`
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
defaults to one isolated sample per framework. Weekly and `benchmark-v*` tag
runs execute ten isolated samples per framework. Raw results and the generated
summary are uploaded even when an individual measurement reports failure.
