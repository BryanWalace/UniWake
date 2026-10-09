# M10 review — Code Reviewer (sync-ready data layer)

Reviewed: commit 4f820ff + M10-D regressions · Date: 2026-10-09 · Lens: correctness, security,
enforceability (constitution §2.3 as amended by ADR-031).

## Break-it pass (M10-D, Debug)
| # | Probe | Result |
|---|---|---|
| 1 | Migration on a **copy of a populated v1.0 database** (v1.0 code at `7297341` in a detached worktree, demo seed: 4 rooms, 60 devices, 3 tags, 28 tag links, 2 schedules, 690 events; plus a user, an exception and 4 settings written as v1.0 would) | schema 3→4, every table count and row identical, `wake.interfaces`/`update.mode` moved to `machine_settings` with the same values, 74 rows baselined, `verifyChangeLog` clean. The new hub started on a second copy: pre-migration backup, migration, instance created, baseline 74, listening. |
| 2 | Power cut between write and log | `touch` runs inside the service transaction: an injected change-log failure leaves no room and no audit row (regression "a failure while logging rolls the write back"). |
| 3 | Bulk operations at 500 devices | bulk move of 500 devices with logging < 250 ms (best of 5, perf pass), one device edit < 5 ms. |
| 4 | Demo seed and backdating | logged (`verifyChangeLog` after a demo start). |
| 5 | Restore | a real hub restored from a backup gets a new `instance_id` and a consistent log. |
| 6 | Write paths outside the API harness | the checker now also runs in the monitor, retention and scheduler suites; retention's run pruning drops log rows without tombstones. |
| 7 | Room id reuse after delete | reproduced the latent v1.0 bug (SQLite reused the highest rowid) and fixed it (AC-005-12). |

## Findings
- **R-M10-01 (MINOR, accepted)** `ChangeLog.instanceId()` reads the `instance` row on every write.
  Cheap (primary-key lookup) and it can never return a stale identity after a rotation; no cache.
- **R-M10-02 (MINOR, accepted)** The `user` snapshot holds the argon2id hash in `change_log`; same
  file and ACL as `users` itself; no API exposes the log. v1.2 transport must be encrypted (§B).
- **R-M10-03 (MINOR, fixed)** Snapshots of a corrupt stored setting crashed the logger; non-JSON
  text now travels as the raw string (settings-service corrupt-value test).
- No CRITICAL or MAJOR findings open.
