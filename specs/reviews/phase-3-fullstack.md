# Phase 3 — Senior Fullstack (lead) self-review + consolidation

Date: 2026-10-04 · Inputs: `tasks.md` v0.1, `phase-3-architect.md`, `phase-3-reviewer.md`,
`phase-3-debug.md`.

## 1. Self-review (before reading the others)
- Biggest schedule risk is M8 (installer/updater): it can only be iterated on Windows CI. I'll push
  a skeleton `release.yml` and the installer smoke early in M8 and iterate.
- Web tasks are coarse (M2-T08 "devices list" is close to the 2 h limit). Acceptable; split while
  implementing if they grow.
- The `windows-host` adapter (M8-T04) is needed earlier by health (M6-T09). Reorder: the adapter's
  read-only checks move into M6-T09; service/scheduled-task control stays in M8-T04.

## 2. Consolidation
| Finding | Decision | Change |
|---|---|---|
| Arch: unmapped AC-002-06, AC-008-05 | Accepted | New M2-T14 E2E |
| Arch: unmapped AC-009-01 | Accepted | New M4-T15 E2E (needs SSE + simulated prober) |
| Arch: AC-001-01b, NFR-08 manual | Accepted | Phase 5 tasks V-T05, V-T06 |
| Arch: shorthand refs | Accepted | Refs written in full |
| Arch: NFR-02/06/07/09 | Accepted | NFR refs added; axe sweep M6-T12; Edge smoke M8-T11 |
| Arch: retention cleanup | Accepted | New M4-T16 |
| Arch: settings at runtime | Accepted | M6-T05 extended |
| Arch: Phase 5 tasks | Accepted | New "Phase 5" section |
| R3-01 `check:trace` | Accepted | New M1-T20; AC IDs in test titles (header rule) |
| R3-02 web states | Accepted | Header rule for web tasks |
| R3-03 E2E earlier, CSP-fail harness | Accepted | Harness moves to M2-T13 |
| R3-04 fault injection named | Accepted | Test column of M3-T08, M4-T06, M5-T04, M8-T07 |
| R3-05 UDP loopback contract | Accepted | M3-T06 |
| R3-06 gitleaks | Accepted | M1-T05 |
| R3-07 installer test link | Accepted | M8-T03 → M8-T09 |
| R3-08 Edge smoke | Accepted | M8-T11 |
| D3-01 cleanup in chunks, not during jobs | Accepted | M4-T16 |
| D3-02 break-it checklist | Accepted | Header "Break-it checklist" |
| D3-03 midnight / month-end tests | Accepted | M5-T01 |
| D3-04 helper soak | Accepted | M4-T03 |
| Self: `windows-host` read-only checks earlier | Accepted | M6-T09 |

Nothing rejected. `tasks.md` is now v1.0.
