# Phase 6 review — Senior Fullstack

Reviewed: ADR-031..034 drafts, plan §5.2 · Date: 2026-10-08
Lens: can this be built without destabilising a finished, validated v1.0?

- **F6-01 (MAJOR)** Repositories are constructed in ~60 places (services + tests). Passing a new
  `ChangeLog` argument everywhere is churn with no value. → one `ChangeLog` per `Db` (registry keyed
  by the connection), its clock configured by `createServices`; repositories call `changeLog(db)`.
  Accepted (plan §5.2).
- **F6-02** Repositories should not have to compute UUIDs in their INSERTs. → `touch` fills `uuid`
  when it is NULL (random v4; v5 for runs). INSERT statements stay as they are. Accepted.
- **F6-03** `updated_at` already set by repositories with the injected clock (tests assert it);
  `touch` must not overwrite it there. → `touch` only fills `updated_at` on the tables that gain the
  column. Accepted.
- **F6-04 (MINOR)** The settings form is generated from metadata; showing "Somente neste PC" is a
  one-line change once `scope` exists. Accepted (AC-017-09).
- **F6-05 (MINOR)** API keeps integer ids; nothing in the web client changes except the health page
  identifier.
