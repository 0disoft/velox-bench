# AGENTS.md

This repository owns public, reproducible cross-framework benchmark fixtures
for Velox. It does not own Velox product code.

## Rules

- Never publish a benchmark number that was entered by hand.
- Keep framework versions and immutable upstream revisions in `bench.lock.json`.
- Keep common fixture bytes identical across adapters.
- Include acquisition, installation, and packaging in end-to-end cold-build time.
- Preserve failed and timed-out samples in raw evidence.
- Do not use benchmark caches in the zero-cache suite.
- Do not claim a winner until repeated hosted evidence exists.

