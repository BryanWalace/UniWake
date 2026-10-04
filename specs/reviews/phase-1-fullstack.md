# Phase 1 review — Senior Fullstack Developer

Reviewed: `specs/spec.md` v0.1 · Date: 2026-10-04
Lens: feasibility, UX for the operator and technician, simpler implementation.

## 1. Conflicts and gaps
**F1-01 Device name uniqueness vs enrollment (FR-002.1, AC-007-05).** Enrollment sets
`name = hostname`. Unique names make enrollment fail whenever two rooms have a "PC-01", or a
cloned image wasn't renamed yet. MAC is the real identity.
*Proposal:* name is required but **not unique**; the UI warns on duplicates.

**F1-02 How does the script reach the target PC? (FR-007.1/7.3)** "Download the script" from a
panel that is loopback-only means the technician walks a USB stick to each PC.
*Proposal:* the agent listener also serves `GET /agent/prepare-target.ps1`. The panel shows
a single copy-paste command that downloads and runs it with the right parameters. This needs
ADR-005 amended (agent routes: health, enroll, script).

**F1-03 Elevation.** The command must run in an elevated PowerShell. The script should check for
admin first and print "Abra o PowerShell como Administrador e execute novamente" instead of
failing half-way.

**F1-04 Confirmation round-trip (SR-10).** The UI can't know the resolved count before asking.
*Proposal:* `POST /api/wake/preview` returns `{count, rooms[], excluded[], needsConfirmation}`
for any target. The UI always shows a short summary ("Vai ligar 28 máquinas em Lab 3"); the
confirmation dialog appears only when `needsConfirmation`. The same resolver runs for preview and
execution, so the counts agree unless data changed in between (then the server returns 409 again
with the new count, which is the correct behavior).

**F1-05 CSV in Brazil.** Excel pt-BR saves CSV with `;` and expects UTF-8 **with BOM**, otherwise
accents break.
*Proposal:* import auto-detects `,` / `;` and accepts headers with or without accents
(`observacoes`/`observações`); export uses `;` + BOM by default.

**F1-06 Hub URL in the command.** The controller may have several IPs. The "Preparar máquinas"
page should let the operator pick which address the targets will use (default: the interface
with the default gateway) and remember it.

**F1-07 Room code.** Generate automatically from the name (`Lab 3` → `LAB3`), editable, unique,
`[A-Z0-9-]{2,16}`.

## 2. UX details to add to the spec
- Dates in pt-BR format (`dd/mm/aaaa HH:mm`, 24 h). Relative times ("há 3 min") with absolute on
  hover.
- Touch targets ≥ 44 px on room-card buttons (tablet).
- Room cards order: block → floor → name. "Sem sala" last.
- FR-015 demo seed should include schedules, one past "morning result" and some history, so every
  screen has content on first run.
- Room daily uptime = average of its devices' daily uptime.

## 3. Feasibility notes (for Plan)
- Live updates: SSE + TanStack Query cache updates; simple and resilient.
- Uptime calculation from `status_events` is a pure function; easy to test at 80%+.
- The schema ↔ settings-form test (NFR-03) is feasible if the form is generated from field
  metadata in `packages/shared`.
- FR-016 log viewer: tail the current pino file with a byte limit; no log database needed.

## 4. Improvements proposed
- **IMP-024** Wake preview for every wake (F1-04). Effort S.
- **IMP-025** One-line enrollment command served by the agent listener (F1-02). Effort S.
