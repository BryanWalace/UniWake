# Phase 6 review — Architect (spec revision for roadmap §A)

Reviewed: constitution v1.1, spec v1.1, plan v1.0, schema 001–003, repositories · Date: 2026-10-08
Lens: does the v1.0 data model meet `.agents/07-roadmap-features.md` §A?

## Gap analysis against §A
| §A requirement | v1.0 state | Gap | Resolution |
|---|---|---|---|
| No 24/7 server; sync-ready data | Integer keys, hard deletes, no history of writes | MAJOR | ADR-031 (uuid + Lamport `rev` + change log) |
| Stable UUID per syncable entity | none | MAJOR | `uuid` column, assigned once by `ChangeLog.touch` |
| `updated_at`, `updated_by_instance` | `updated_at` on rooms/devices/schedules/settings only | MAJOR | columns added to every replicated table |
| Soft-delete (tombstone) | hard deletes | MAJOR | tombstone row in the change log (ADR-031 §5) |
| Writes through a repository appending to a change log | repositories exist, no log | MAJOR | `touch`/`tombstone` in every write path + `verifyChangeLog` |
| Persistent `instance_id` | none | MAJOR | `instance` table, ADR-033 |
| Machine-specific settings separated | one `settings` table; ports already in `config.json` | MAJOR | `scope` + `machine_settings`, ADR-032 |
| Scheduler ready for leader election | claim row only | MINOR | `ExecutionLease` port, deterministic run UUID, ADR-034 |
| Panel on the LAN, multi-user, roles | done (FR-006, ADR-012) | — | — |

## Decisions
- Keep local integer keys; the UUID is the global identity (ADR-031 §2). Changing every key would
  touch every route, client type and most of the 728 tests and give peers nothing they need.
- One log row per entity (state-based) instead of an append-only history; tombstones live there.
- Classification table in plan §5.2 is now binding (constitution §2.3).

## Found while reviewing
- **A6-01 (MAJOR, bug)**: schedule targets keep a bare local `ref_id`. SQLite reuses the highest
  rowid after a delete, so a schedule on a deleted room can silently target the next room created.
  → `ref_uuid` + clear `ref_id` on delete (ADR-031 §8), AC-005-12.
- **A6-02**: the scheduler pause is team intent (holidays); keeping it machine-local would let the
  colleague's PC wake labs during a pause. → replicated entity `scheduler_pause`.

Consolidation: phase-6 reviews by Fullstack, Debug and Reviewer below were all applied to spec v1.2,
plan v1.1 and tasks M10. M10 may start.
