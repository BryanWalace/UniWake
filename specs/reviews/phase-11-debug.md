# Phase 11 review — Debug / Problem Solver

Date: 2026-10-12 · Lens: how this fails at the institution.

- **D11-01 (MAJOR)** "Desfazer importação" restores the `pre-import` backup: anything changed
  after the import (a room added, a schedule edited) is lost too. → the confirm text says so, and
  "Desfazer" is offered only until the next import or 7 days (FR-403.4).
- **D11-02 (MAJOR)** argon2id with 64 MiB per call: several exports/imports at once could take
  hundreds of MB on a small IT PC. → one KDF at a time (queue), plan §16.7.
- **D11-03 (MINOR)** A PC in standby that then joins a team takes the team's live data; staying in
  standby would silently stop its schedules. → joining a team clears standby (FR-404).
- **D11-04 (MINOR)** A network share that is offline at 02:45 → no file that night; the health
  warning stays until the next success, and the next run writes normally.
- **D11-05 (MINOR)** Old PC still on after a migration: lab PCs keep its address and check in there;
  the new PC (other address) never hears from them until they are prepared again. → help page and
  README explain "se o novo PC tiver outro endereço, rode de novo o comando de preparo".
- **D11-06 (INFO)** Crash during import: one transaction (NFR-402); the `pre-import` backup is
  taken before the transaction, so a crash leaves the old data and a usable backup.
