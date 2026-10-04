# Phase 2 review — Architect (lead) + consolidation

Date: 2026-10-04 · Inputs: `plan.md` v0.1, `phase-2-fullstack.md`, `phase-2-debug.md`,
`phase-2-reviewer.md`.

## 1. Self-review of draft v0.1 (before reading the others)
- **A2-01 Initial schema.** The plan lists tables but not how the first migration and the seed of
  default settings happen. Decision: `001_initial.sql` creates everything; settings are not
  seeded (absent = default, constitution §2.4).
- **A2-02 `config.json`.** Contents undefined. Decision: `{ panelPort, agentPort, panelBind,
  agentBind, logLevel }` only; everything else is a DB setting.
- **A2-03 SSE fan-out.** One events bus in-process; each SSE client is a subscriber; drop slow
  clients whose socket buffer exceeds 1 MB (they reconnect and refetch).
- **A2-04 Dev data dir** not specified (Fullstack F2-06 covers it).

## 2. Consolidation

### Accepted
| Finding | Change | Record |
|---|---|---|
| F2 toolchain table (TS 6.0, ESLint 10 w/o eslint-plugin-react, @types/node 24, Vite 8, Vitest 5) | plan §4 | **ADR-024** (amends constitution §4.1 wording of the no-danger rule) |
| F2-01 own keyed limiter for per-user/per-account | plan §4 | — |
| F2-02 Luxon gap behavior | plan §7.2 note + DST tests | ADR-008 unchanged |
| F2-06 dev loop, `.dev-data/` | plan §12 | — |
| F2-07 SPA fallback excludes `/api`, `/agent` | plan §6.1 | — |
| F2-08 web routes | plan §6.5 (new) | — |
| F2-09 compact unpaginated device list | plan §6.1 | — |
| F2-10 test fakes outside `src/` | plan §3 | — |
| F2-11 build-time version | plan §9 | — |
| D2-01 updater via Task Scheduler | plan §8 | **ADR-023** |
| D2-02 watchdog task | plan §8, spec AC-001-13 | ADR-023, IMP-027 |
| D2-03 composite prober with `ping.exe` fallback | plan §4, FR-012 health line | **ADR-019** |
| D2-04 DB on the event loop rules | plan §5.1 (new) | **ADR-017** |
| D2-05 restore DB only if migrations ran | plan §8 | ADR-023 |
| D2-06 disk-space check | plan §8, `UPDATE_DISK_SPACE` | — |
| D2-07 port in use → event log + distinct exit | plan §9 | IMP-028 |
| D2-08 per-interface send failures | plan §7.1 note | — |
| D2-09 installer hang handling | plan §8 | — |
| D2-10..14 | plan §§4, 6.3, 7.2, 9, 12 | — |
| R2-01 update source build-time constant | plan §8 | **ADR-025** |
| R2-02 process execution rules | plan §9.1 (new) | ADR-021 |
| R2-03 session token details | plan §6.4 (new) | — |
| R2-04 no state-changing GET | plan §6 | — |
| R2-05 runtime dependency table + check | plan §4.1 (new) | IMP-029 |
| R2-06 PFX password file | plan §9 | **ADR-026** |
| R2-07 workflow hardening | plan §12 | — |
| R2-08 settings audit diff + redaction list | plan §6 | — |
| R2-09..13 | plan §§6, 11 | — |
| Decisions listed in plan §4 | recorded | **ADR-017..022** |

### Improvements
- IMP-026 (Ctrl+K quick-wake palette): **accepted, low priority** → FR-004.7; it reuses
  preview/confirm, so no new rules. Implemented after the core dashboard.
- IMP-027, IMP-028, IMP-029: accepted.

### Rejected
- None. One adjustment: Fullstack proposed eslint-plugin-import-x for boundaries (plan said
  eslint-plugin-import); accepted, as it supports ESLint 10.
