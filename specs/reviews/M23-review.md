# M23 review — Panel, automatic exports, CLI (v1.4)

Date: 2026-10-12 · Scope: M23-T01..T04 · `web/features/migration/*`, standby banner, help topic,
`application/migration/auto-export.ts`, `adapters/export-folder.ts`, `cli/migration-cli.ts`, `main.ts`.

## Architect
- The standby banner reads the dashboard (operators see it too); the admin-only state endpoint
  feeds the page. Automatic exports reuse the export service; the CLI import reuses the full hub
  composition without listening, so it behaves exactly like the panel.
- **A-M23-01 (MAJOR, avoided in design)** reusing `HubKeyService` in the CLI would be wrong: when
  the key cannot be opened in the CLI's context it **retires the running service's key** and makes
  a new one (lab PCs would stop trusting the hub). The CLI reads the active key read-only and
  leaves it out (with a warning) when it cannot open it.

## Senior Fullstack
- Raw upload and file download helpers in the API client (F11-01); typed confirmations for
  IMPORTAR, ATIVAR and DESFAZER; every new view has loading, empty and error states (web tests).
- E2E AC-403-06 and the axe sweep of `/backup` and `/ajuda/backup-migration` pass.

## Debug
- Automatic export: missing folder → health warning until the next success; rotation touches only
  this PC's `UniWake-<PC>-<day>.uniwake` files; a half-written file never has the final name.
- CLI: export refuses a database of another schema version (never migrates under a running
  service); import refuses while a hub answers on the panel port; exit codes tested.
- **D-M23-01 (MINOR, fixed)** the CLI default sections included the secret ones, so a plain
  `--export file` failed for lack of a password → without `--password-env` the default leaves them
  out.

## Code Reviewer
- Test passwords are low-entropy (gitleaks flagged the first ones; fixed before commit).
- **R-M23-01 (INFO)** writing to a network share as LocalSystem is **não verificado** at the
  institution (computer-account permissions); README/help explain it, owner checklist V4-T02.

No open CRITICAL/MAJOR. **M24 may start.**
