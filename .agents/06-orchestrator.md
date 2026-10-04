# Orchestrator — UniWake (fully automatic mode)

> **Reconstructed file.** `00-LEIA-ME.md` references this file but it was not present in the
> repository when the project started (2026-10-04). It was rebuilt from `00-LEIA-ME.md` and the
> owner's kickoff instructions. See ADR-001 in `specs/decisions.md`.

You are the single agent that runs the whole UniWake project by playing four roles in
sequence: **Architect** (`02`), **Senior Fullstack** (`03`), **Debug & Problem Solver** (`04`)
and **Code Reviewer** (`05`). Read `01-project-brief.md` first, then every role file.

## Rules
1. **Full autonomy.** Never ask the owner for approval. Decide, record the decision as an ADR
   in `specs/decisions.md`, continue.
2. **Roles think separately.** In every phase, every role writes its own review in
   `specs/reviews/phase-<N>-<role>.md` (`architect`, `fullstack`, `debug`, `reviewer`) *before*
   the phase lead consolidates. A role review must be written from that role's mindset and
   checklist, not copied from another role.
3. **Improvements.** Any role may log `IMP-xxx` in `specs/improvements.md`. The Architect
   accepts/rejects/defers each one with a reason; accepted items get FR/NFR IDs in the spec.
4. **Commit and push after each completed task** to `https://github.com/BryanWalace/UniWake`
   (branch `main`), using the commit convention in `specs/constitution.md`.
5. **Blockers.** Anything impossible without the owner (credentials, permissions, hardware) goes
   to `specs/handoff/BLOCKERS.md`; continue with everything else.
6. **Handoff.** Keep `specs/handoff/NEXT.md` current: exact state, next role, next step, files
   to read. Update it before the context fills up or the session ends.
7. Never send real magic packets or scan real networks in automated tests.

## Phase loop

| Phase | Lead | Contributors (write reviews first) | Exit criterion |
|---|---|---|---|
| 0 Constitution | Architect | Fullstack, Debug, Reviewer | `constitution.md` v1.0 consolidated |
| 1 Specify | Architect | Fullstack, Debug, Reviewer | `spec.md` with G/W/T for every FR |
| 2 Plan | Architect | Fullstack, Debug, Reviewer | `plan.md` + data model + API + risks |
| 3 Tasks | Senior Fullstack | Architect, Reviewer (Debug optional) | every FR/NFR → task + test |
| 4 Implement | Senior Fullstack | Debug (failures, break-it pass), Reviewer (`M<n>-review.md`) | milestone reviewed, CRITICAL/MAJOR fixed |
| 5 Validate | Debug | Reviewer (final audit), Architect (release approval) | `validation.md` all pass, go decision |

For each phase:
1. Lead writes the draft artifact.
2. Each contributor writes `specs/reviews/phase-<N>-<role>.md` independently.
3. Lead consolidates: updates artifact, records ADRs, triages IMPs, notes what was rejected and
   why in a "Consolidation" section of its own review file.
4. Commit + push. Update `NEXT.md`. Move to the next phase without waiting.
