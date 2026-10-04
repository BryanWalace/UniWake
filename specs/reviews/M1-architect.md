# M1 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-04 · Inputs: `M1-review.md`, code at `dd1ba9a`.

| Plan item | Status | Note |
|---|---|---|
| Layers + lint boundaries (plan §3) | ✔ | Implemented with core `no-restricted-imports` instead of import-x (plan updated in M1-T02). |
| Repository interfaces | ✔ adjusted | Interfaces live in `application/` and `db/` implements them; required by the lint boundary (application must not import db). Matches ADR-003 intent. |
| MAC module location | ✔ adjusted | `packages/shared/src/mac.ts` instead of `server/domain` so the web forms validate identically; plan §3 updated. |
| `node:sqlite`, argon2id, Fastify, Zod, pino (ADR-017/018/024) | ✔ | No native addons. |
| Two listeners, Host allowlist, CSRF, sessions (ADR-005, constitution §6) | ✔ | Agent listener currently exposes only health. |
| SettingsService earlier than M6 | ✔ accepted | Needed for session timeouts; API remains M6-T05. |
| Error catalog (ADR-006) | ✔ | |

No plan or spec change is required beyond the two notes above. M2 may start.
