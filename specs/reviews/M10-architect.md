# M10 — Architect conformance

Date: 2026-10-09 · Against: ADR-031..034, constitution §2.3/§2.4 v1.2, plan §5.2, roadmap §A.

| §A item | Where | Evidence |
|---|---|---|
| Stable UUID per entity | `touch` assigns; run UUID v5 | AC-017-02, AC-017-07 |
| `updated_at`, `updated_by_instance` | migration 004 + `touch` | AC-017-02 |
| Tombstones | `change_log.op = 'delete'` | AC-017-03 |
| Writes through repositories into the change log | every repository; checker in all write suites | AC-017-02, harness close |
| Persistent `instance_id` | `instance` table; rotation on restore | AC-017-01, AC-017-08 |
| Machine settings separated | `scope` + `machine_settings` | AC-017-05, AC-017-09 |
| Scheduler ready for leader election | `ExecutionLease` port | AC-017-06 |
| Existing data preserved | migration only adds; baseline | AC-017-04 + populated copy (M10-review #1) |

Layering respected (`db/sync` imported by repositories, services and the hub only). Plan §5.2
named a domain `uuid-v5.ts`; it lives in `db/sync/uuid.ts` because it hashes with `node:crypto` and
only the db layer needs it — plan updated. **v1.2 may start.**
