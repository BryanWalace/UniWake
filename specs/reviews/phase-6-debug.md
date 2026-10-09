# Phase 6 review — Debug / Problem Solver

Reviewed: ADR-031..034 drafts · Date: 2026-10-08
Lens: how does this fail on a real PC?

- **D6-01 (MAJOR)** Upgrading a hub with months of data: the migration must not lose rooms,
  devices, tags, schedules or settings, and existing rows must become syncable. → migration 004 only
  adds columns/tables and moves machine-scope settings with their values; a start-up baseline logs
  rows with `rev = 0`. Test on a populated schema-3 copy (AC-017-04). The pre-migration backup
  (constitution §2.3) still runs first.
- **D6-02 (MAJOR)** Power cut between a write and its log row would desynchronise peers forever. →
  `touch` runs in the caller's transaction (savepoint when nested); the checker proves consistency.
- **D6-03 (MAJOR)** Restoring a backup rewinds the change-log sequence and the Lamport clock; a peer
  that already pulled "since 900" would skip the restored instance's new rows 850–900. → restore
  rotates the `instance_id` (ADR-033); clock ≥ highest restored `rev`.
- **D6-04** Baseline order matters: schedules reference rooms/tags/devices by UUID, so rooms, tags
  and devices are logged first. → fixed order in the baseline.
- **D6-05** Bulk operations (delete 500 devices, CSV 5000 rows) now do one snapshot each. Measure in
  M10-D; must stay well under the 50 ms per request path rule for normal operations.
- **D6-06** Retention prunes old schedule runs nightly; turning that into tombstones would make every
  PC delete the others' history. → retention drops log rows without tombstones.
