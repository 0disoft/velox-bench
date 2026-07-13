# Velox Bench

Public benchmark contracts and fixtures for Velox, Wails, and Neutralinojs.

This repository currently contains pinned adapter sources and fixture drift
checks. It intentionally publishes no performance table yet. Numbers become
publishable only after the zero-cache hosted workflow, result schema, repeated
samples, and summary generator are implemented and reviewed together.

## Current Pins

- Velox: commit `57e5e7bac7e6fe4a26d6dba563fad8dd66d60983`
- Wails: `v2.13.0`
- Neutralinojs core and client: `v6.8.0`
- Neutralinojs CLI: `v11.7.2`
- Runner: `windows-2025`

## Local Contract Check

```text
bun run check
```

The check validates `bench.lock.json`, rejects mutable versions, and proves
that every adapter's HTML, CSS, and JavaScript fixture matches the canonical
fixture byte for byte.

