# Phase 0 review — Architect (lead) + consolidation

Date: 2026-10-04 · Inputs: constitution v0.1, `phase-0-fullstack.md`, `phase-0-debug.md`,
`phase-0-reviewer.md`.

## 1. Self-review of draft v0.1 (written before reading the others)
- **Risk concentration.** The two features most likely to fail in the field, self-update and
  cross-VLAN delivery, are the ones we can least test automatically. The constitution must make
  them observable (logs, health, rollback) because we cannot prove them correct in CI.
- **Missing operator-safety rule.** A global pause is in the brief. A pause forgotten after a
  holiday week means Monday's labs stay off and nobody knows why. → IMP-020.
- **Missing "result of the morning".** The operator's real question at 07:00 is "which machines did
  *not* come up?" The draft logs everything but promises no summary. → IMP-019.
- **Over-engineering check.** Hexagonal + ports everywhere could slow CRUD. Keep ports only at
  real boundaries (same conclusion as Fullstack §1).

## 2. Consolidation — decisions on every finding

### From Senior Fullstack
| Item | Decision | Where |
|---|---|---|
| Repositories not faked; in-memory SQLite in tests | **Accepted.** Real engine > hand-written fake. | ADR-003, constitution §2.2, §5 |
| Node 24 LTS, bundled runtime | **Accepted.** | ADR-002 |
| npm workspaces | **Accepted.** | ADR-004 |
| §4 contradiction on pt-BR messages | **Accepted** — shared catalog. | ADR-006, §4 |
| Native addons need ADR; hashing must not force a native dep | **Accepted.** Built-in `node:sqlite` and `crypto.argon2` exist in Node 24.15 (verified on the dev machine); evaluate them in Plan. | ADR-010, §6 |
| SSE over WebSocket | **Deferred to Plan** (likely accepted). | Plan |
| `npm run dev` with demo data | **Accepted** with IMP-001. | §3 |
| UI proposals (room cards, drawer, per-room URL, `/` search, tablet) | **Accepted into Phase 1 spec input.** Dark mode rejected for v1. | Spec |
| IMP-001..003 | Accepted. IMP-004 deferred to Plan. | improvements.md |

### From Debug
| Item | Decision | Where |
|---|---|---|
| P2 vs FR-007 conflict | **Accepted** — two network surfaces. | ADR-005, P2, §6 |
| Per-interface send, interfaces read at send time | **Accepted.** | §2.6 |
| Packet log (P4) | **Accepted.** | P4, IMP-006 |
| ECONNREFUSED = alive; "desconhecido" ≠ "offline" | **Accepted, spec-level.** | Carried to Phase 1 |
| Claim-then-execute scheduler; DST rules; tick-based timer | **Accepted.** | ADR-008, §7 |
| Separate updater process, side-by-side versions, pre-update DB backup | **Accepted.** | ADR-009, §7 |
| One active wake job per device | **Accepted, spec-level.** | Carried to Phase 1 |
| PowerShell 5.1 rules (BOM, CRLF, StrictMode) | **Accepted.** | §4.2 |
| `synchronous=FULL`, daily backups | **Accepted.** | §2.3, IMP-010 |
| Fakes support fault injection | **Accepted.** | §2.2, §5 |
| IMP-005..013 | All accepted (see improvements.md for scope notes). | improvements.md |

### From Code Reviewer
| Item | Decision | Where |
|---|---|---|
| R0-01 loopback-only first-run setup | **Accepted** (CRITICAL). | §6 |
| R0-02 Host allowlist | **Accepted** (CRITICAL). | §6 |
| R0-03 sessions + CSRF | **Accepted.** Idle 12 h / absolute 7 d defaults, tunable. | §6 |
| R0-04 enrollment tokens | **Accepted.** | §6 |
| R0-05 enforce no-network | **Accepted** — lint + runtime guard. | §5 |
| R0-06 route-table authz test | **Accepted.** Route without declared auth fails startup. | §5, §6 |
| R0-07 honest update integrity | **Accepted.** Signing → BLOCKERS B-001. | ADR-009 |
| R0-08 supply chain | **Accepted.** Secret scanning: GitHub's built-in push protection plus a CI step. | §6.4 |
| R0-09 PowerShell standards + Pester | **Accepted.** | §4.2, §5 |
| R0-10 DoD additions | **Accepted.** | §9 |
| R0-11 timeout defaults | **Accepted for Plan** (numbers live in plan.md). | Plan |
| R0-12 config precedence | **Accepted:** defaults < file < env. | §2.4 |
| R0-13 coverage metrics/globs | **Accepted.** | §5 |
| R0-14 breaking changes + generated notes | **Accepted.** | §10 |
| R0-15 password policy | **Accepted.** | §6 |
| R0-16 append-only audit | **Accepted.** | §6 |
| R0-17 security headers | **Accepted.** | §6 |
| CI gate list | **Accepted** as §9.1. | §9.1 |

### Rejected / not adopted
- Dark mode (Fullstack, mentioned as out): rejected for v1. It doubles the visual test matrix for
  low operator value.
- Faking repositories (my own v0.1 §2.2): withdrawn.

## 3. Carried to Phase 1 (spec-level, not constitution)
1. Prober semantics: refused = online; all probes filtered → `desconhecido`.
2. A device is in at most one active wake job; second request → "já em andamento" + link.
3. Enrollment: same MAC updates; cross-room enrollment moves + audits; distinct token errors.
4. Per-room network settings (subnet / broadcast target); cross-VLAN guidance text.
5. Scheduler: grace window default, "perdido" state, DST behavior as ADR-008.
6. Confirmation threshold default value (proposal: 40 devices or > 1 room or "Todos").
7. UI structure from Fullstack §4.
8. All accepted IMPs need FR/NFR IDs.

## 4. Architect improvements
- **IMP-019** "Resultado da manhã": after each scheduled run, a per-room summary of devices that
  did not wake, pinned on the dashboard until acknowledged. The basis for roadmap notifications.
- **IMP-020** Safe global pause: pause requires a reason and has an optional auto-resume date;
  a red banner stays on every page while paused; scheduled runs skipped by pause are logged as
  "pulado (pausa)".
