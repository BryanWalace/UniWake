# M8 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-05

| Plan item | Status | Note |
|---|---|---|
| Packaging (ADR-022, plan §9) | ✔ | esbuild bundles server.mjs + updater.mjs; versions\<ver>\ layout; previous version kept. |
| Node runtime pin | changed | Single pin in `.nvmrc`; official `win-x64/node.exe` (no zip) verified against SHASUMS256.txt. Plan §9 updated. |
| Service (ADR-021) | ✔ | WinSW 2.12 x64 pinned by hash, automatic start, restart 10/30/60 s, LocalSystem. |
| Updater outside the service tree (ADR-023) | ✔ | Task Scheduler tasks from UTF-16 task XML; watchdog 15 min; plan re-validated. |
| Update source constant (ADR-025) | ✔ | `update-source.ts`; only `--test-update-api` (loopback http) overrides, never in release.yml. |
| Event log (IMP-028) | ✔ | eventcreate on start-up configuration errors. |
| Release (FR-001.4) | ✔ | release.yml on `v*` tags with all gates, SHA-256 asset, generated notes. |
| Traceability | changed | check:trace accepts [CI]/[CI-Win] ACs named in workflow step names. |

Open: M8-T12 (end-to-end update on CI against a fake release server). M9 may start once it is done.
