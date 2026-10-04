# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE: `constitution.md` v1.1, `spec.md` v1.1, `plan.md` v1.0, `tasks.md` v1.0.
- Reviews for every phase in `specs/reviews/phase-<N>-<role>.md`.
- ADR-001..026, IMP-001..030. Blockers B-001..003 (`specs/handoff/BLOCKERS.md`).
- Traceability: all 117 ACs, all FR sub-requirements and NFR-01..09 map to tasks.
- No code yet.

## Next: Phase 4 — Implement, milestone M1 (lead: Senior Fullstack)
Start at `M1-T01` in `specs/tasks.md` and go in order. For each task: tests → implement →
`npm run verify` → mark `[x]` → commit `feat(M1-Txx): ...` with `Refs:` trailer → push.
Pinned toolchain (ADR-024): TypeScript 6.0.x, ESLint 10, typescript-eslint 8, import-x,
react-hooks, Prettier 3, Vite 8, Vitest 5, React 19, React Router 8, TanStack Query 5,
Tailwind 4, Zod 4, Fastify 5, `@types/node` 24.
At the end of M1: `M1-D` break-it pass, `M1-R` review in `specs/reviews/M1-review.md`, fixes.

## Files to read first
`CLAUDE.md`, `specs/tasks.md`, `specs/plan.md` §3–§6, `specs/constitution.md` §2, §4, §5.
