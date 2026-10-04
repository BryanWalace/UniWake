# Phase 1 review — Architect (lead) + consolidation

Date: 2026-10-04 · Inputs: `spec.md` v0.1, `phase-1-fullstack.md`, `phase-1-debug.md`,
`phase-1-reviewer.md`.

## 1. Self-review of draft v0.1 (before reading the others)
- **A1-01 Empty schedule targets.** A schedule targeting a room that is later deleted (or a tag
  removed from every device) silently wakes nothing. Spec must show "alvo vazio" on the schedule
  and log the run as `falhou (alvo vazio)` so the morning result flags it.
- **A1-02 Deleting a room/tag referenced by schedules** must warn with the list of affected
  schedules before confirming.
- **A1-03 Job lifecycle states** are implicit. Define: `pendente → enviando → verificando →
  concluído | interrompido | falhou`.
- **A1-04 FR-016 log viewer** should never show secrets; already guaranteed by constitution §4.1
  (nothing secret is logged). No change.

## 2. Consolidation

### Accepted
| Finding | Change in spec v1.0 | Record |
|---|---|---|
| F1-01 names not unique | FR-002.1: name required, not unique, UI warns | — |
| F1-02 + R1-02 script served by agent listener with hash-pinned one-liner | FR-007.3; agent routes = health, enroll, script | **ADR-011** (amends ADR-005, constitution §2.6) |
| F1-03 elevation check | FR-007.1 step 0 + AC | — |
| F1-04 wake preview | FR-003.3, `POST /api/wake/preview`, AC-003-15 | IMP-024 |
| F1-05 CSV `;` + BOM, accent-tolerant headers | FR-002.3 + AC-002-09 | — |
| F1-06 hub address picker | FR-007.3 | — |
| F1-07 room code format | FR-008.1 | — |
| Fullstack §2 UX details | §5 FR-004.5, FR-008, FR-015, new §8 "UI conventions" | — |
| D1-01 firewalled PCs | FR-007.1 step 5 (ICMP rule), FR-004.1 "nunca respondeu", debounce | IMP-021, **ADR-014** |
| D1-02 `desconhecido` definition | FR-004.1 | ADR-014 |
| D1-03 verification probes directly | FR-003.5 | — |
| D1-04 default interfaces with gateway, no APIPA | FR-003.2 | — |
| D1-05 retry when no interface (scheduled jobs) | FR-003.2 AC-003-16 | — |
| D1-06 global stagger cap | FR-003.4 `wake.maxDevicesPerStep` = 30 | — |
| D1-07 test-WoL settle time 30 s | FR-007.4 | — |
| D1-08 multiple missed runs | AC-005-08 | — |
| D1-09 restart mid-job | AC-003-17 | — |
| D1-10 update default `auto` + window + schedule guard | FR-001.3 | **ADR-015** |
| D1-11 health-check 120 s; backup 02:30 | defaults table | — |
| D1-12 reboot / active hours warnings | FR-012 | IMP-022 |
| D1-13 skew from GitHub `Date` header | FR-012 | — |
| D1-14 junk SMBIOS → null | FR-007.2 | — |
| D1-15 `otherMacs[]` | FR-007.2, FR-010 | — |
| D1-16 packet log retention 30 d | defaults | — |
| D1-17 enrollment rate limit per IP | FR-007.2 | — |
| R1-01 LAN panel HTTPS only | FR-006.4 | **ADR-012** (amends constitution §6.1) |
| R1-03 enrollment over HTTP: accepted risk + notice | FR-007.2, FR-004.5 notice | **ADR-013**; IMP-023 → roadmap RM-5 |
| R1-04 CSV injection | FR-002.3, FR-006.5 | **ADR-016** (constitution §6.7 new) |
| R1-05 `react/no-danger` | constitution §4.1 | ADR-016 |
| R1-06 length limits | §8 field limits table | ADR-016 |
| R1-07 minimal public health | FR-012 | — |
| R1-08 missing ACs | added for every FR | — |
| R1-09 matrix rows | FR-006.2 | — |
| R1-10 restore safety | FR-014 | — |
| R1-11..R1-16 | applied as written | — |
| A1-01..A1-03 | FR-005.8, FR-008.1, FR-003.5 states | — |

### Rejected / modified
- **D1-01 proposal to show firewalled devices as `desconhecido`** (from Phase 0, carried) is
  *modified*: we cannot distinguish "off" from "on but filtering everything" (both time out).
  We keep `offline` and add the "nunca respondeu" flag plus the ICMP firewall rule that removes the
  ambiguity at the source. Rationale in ADR-014.
- None of the Phase 1 findings were rejected outright.

## 3. New/updated improvements
IMP-021 accepted (FR-007.1), IMP-022 accepted (FR-012), IMP-023 roadmap (RM-5),
IMP-024 accepted (FR-003.3), IMP-025 accepted (FR-007.3).
