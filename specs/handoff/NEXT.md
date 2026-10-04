# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- **Phase 0 (Constitution): DONE.** `specs/constitution.md` v1.0 consolidated from the Architect
  draft and reviews in `specs/reviews/phase-0-{architect,fullstack,debug,reviewer}.md`.
- ADR-001..010 in `specs/decisions.md`. IMP-001..020 triaged in `specs/improvements.md`
  (IMP-004 deferred to Plan; all others accepted, IMP-016 blocked on B-001).
- Blockers B-001..003 in `specs/handoff/BLOCKERS.md` (signing cert, real hardware, VLAN config).
- No code yet. Repo pushed to `origin/main`.

## Next: Phase 1 — Specify (lead: Architect)
1. Architect writes `specs/spec.md` draft:
   - personas (2 IT operators on different shifts, technician at the target PC),
   - user stories, FR-001..FR-007 + FR-101, NFR-01..06 from the brief,
   - FR/NFR IDs for every accepted IMP (001, 002, 005–013, 019, 020),
   - Given/When/Then for every FR, including explicit scope tests,
   - the 8 items in `phase-0-architect.md` §3 "Carried to Phase 1",
   - out-of-scope list and roadmap (brief §6).
2. Fullstack, Debug, Reviewer each write `specs/reviews/phase-1-<role>.md`.
3. Architect consolidates, records ADRs, commits `docs(phase-1): ...`, pushes, updates this file.

## Then
Phase 2 Plan (Architect) → Phase 3 Tasks (Fullstack) → Phase 4 Implement M1..M9 → Phase 5 Validate.

## Files to read first
`CLAUDE.md`, `.agents/01-project-brief.md`, `specs/constitution.md`,
`specs/reviews/phase-0-architect.md`, `specs/improvements.md`.
