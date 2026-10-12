# M19 review — Panel: Desligar/Reiniciar, schedules, readiness, history (v1.3)

Date: 2026-10-12 · Scope: M19-T01..T05 · commits 4687ab7, 92ace85, 78fcea4, 763607f and the
D-M19-01 fix · web 160 tests, server 9xx tests, Pester 82, E2E `e2e/power.spec.ts`.

## Architect
- The panel only talks to the hub API (`/api/power/*`, `/api/devices/:id/agent*`); no new route
  touches lab PCs directly (ADR-043: the PCs pull, nothing is pushed).
- Readiness is computed once on the hub (`domain/readiness.ts`) and reused by the preview, the
  inventory badge, the device card and the history inference.
- Owner decisions honoured: Q-1 (flag + per-schedule excluded tags; manual shutdown of a flagged
  machine needs `confirmProtected`, enforced by the hub, not just the dialog), Q-6 (only "havia
  usuário logado" and the session count are shown), Q-7 (manual default 1 min, "5 min com
  adiamento" option, preview counts machines with a user), Q-9 (late wake shown as "Pulado:
  acordou {n} min após o horário"), Q-10 (restart manual only).

## Senior Fullstack
- Every new screen has loading, empty and error states with retry (device card, history section,
  readiness list failure leaves the inventory usable).
- Revoke is admin-only on the hub (`auth: 'admin'`) and hidden for operators.
- The Preparar options are applied explicitly ("Atualizar comando"); a note says when the copied
  command does not yet carry edited options (found in review, MINOR, fixed).

## Debug break-it
- **D-M19-01 (MAJOR, fixed)** "Pasta persistente" accepted any `X:\path` matching the safe-character
  pattern, e.g. `C:\Windows`, `D:\Users\Public` or `T:\..\Windows`. The preparation runs
  `Protect-UwFolder` on it (owner Administrators, protected ACL with only Administrators/SYSTEM),
  which on a Windows or shared folder would remove TrustedInstaller/Users access and break the PC
  or lock users out of their files. → shared `persistentPathSchema` refuses top-level Windows
  folders and `.`/`..` parts (panel and hub); `prepare-target.ps1` applies the same rule
  (`Test-UwPersistentPathSafe`), refuses an existing folder that holds files not created by
  UniWake or is a link (`Get-UwFolderState`), writes a marker file when it prepares a folder so a
  second run reuses it, and in every refused case writes no `persistentPath` in the agent config
  (the agent keeps its own folder). Tests: `agent-enroll` (11 bad paths → 422), Pester
  `D-M19-01`, web `prepare-page`.
- Inventory with hundreds of devices: one `GET /api/power/agents` every 30 s, mapped in memory.
- History rows for occurrences executed with the hub off arrive on later check-ins and aggregate
  into the same row (AC-307-01, server test).

## Code Reviewer
- No `any`, no unchecked casts beyond test fixtures; eslint/prettier/typecheck clean.
- pt-BR UI strings; no user names, IPs or MACs of the institution in fixtures.

## Open items (INFO)
- **R-M19-01** The inventory badge says "Precisa do novo preparo" for every machine of a v1.2
  installation until it is prepared again: intended (FR-309), explained in the help page (M20-T01).
- **R-M19-02** The reserved-folder list is a guard against mistakes by operators, who already run
  the command as administrators; it is not a security boundary.

No open CRITICAL/MAJOR. **M20 may start.**
