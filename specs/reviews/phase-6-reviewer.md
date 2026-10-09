# Phase 6 review — Code Reviewer

Reviewed: ADR-031..034 drafts, constitution §2.3/§2.4 amendments · Date: 2026-10-08
Lens: security, testability, enforceability.

- **R6-01 (MAJOR)** "Every write goes through a repository that appends to the change log" is not
  checkable by reading code. → `verifyChangeLog(db)` (rows ↔ log rows: same `rev`, same snapshot, no
  live tombstones) runs when every API test harness closes, so any route that writes without logging
  fails CI. Accepted (ADR-031 §6).
- **R6-02 (MAJOR)** The `user` snapshot carries the argon2id password hash. It must never appear in
  an API response, a log line or an unencrypted export. → the change log has no API in v1.0; v1.2
  transport is encrypted and authenticated (roadmap §B); v1.4 export treats it as a secret
  (password-protected). Lock-out counters stay local. Recorded in ADR-031 consequences/plan §5.2.
- **R6-03** Machine settings must never leak into the replicated `settings` table by mistake. →
  `scope` is a required field of every setting definition (type error otherwise) and a test checks the
  storage split (AC-017-05/09).
- **R6-04 (MINOR)** New ACs follow the `AC-017-nn` pattern so `check:trace` enforces them.
