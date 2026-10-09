# Phase 7 review — Debug / Problem Solver

Date: 2026-10-09 · Lens: real PCs, real failures.

- **D7-01 (MAJOR)** Joining: if the PC crashed after wiping its data and before receiving the
  team's, it would be left empty. → the joiner first pulls the full team state into memory, then
  wipes and applies it in **one** transaction (plan §14.4, FR-201.2).
- **D7-02 (MAJOR)** Elected executor goes off between election and execution → nobody wakes the
  labs. → fallback after 90 s by the next candidate (ADR-039, AC-204-03).
- **D7-03** The executor PC turned off mid-job leaves the run `executando` on the others until it
  starts again (its `failStale` then fixes and syncs it). Accepted; shown with the PC's name.
- **D7-04** Windows Firewall or a domain GPO can block 47102 even with the installer rule. → status
  shows offline + last error in pt-BR; help page lists the check (RK-18).
- **D7-05** Multi-NIC PCs: announce on every interface's subnet broadcast (same rule as WoL).
- **D7-06** A peer's clock may be hours off: only Lamport revisions order versions; wall times are
  display-only.
