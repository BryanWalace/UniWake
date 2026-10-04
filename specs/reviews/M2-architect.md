# M2 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-04 · Inputs: `M2-review.md`, code at `946eec2`.

| Plan item | Status | Note |
|---|---|---|
| Data model (rooms, devices, device_state, tags, device_tags) | ✔ | As plan §5; `device_state` row created with each device. |
| API (plan §6.1) rooms/tags/devices/CSV/bulk | ✔ | Plus `GET /api/tags/:id/delete-impact` (listed) and bulk delete requiring `confirm`. |
| Static panel `GET /*` | ✔ | Own route so the auth registry applies (plan §6.1 row "SPA files"). |
| Web routes (plan §6.5) | ✔ adjusted | Added `/salas` (rooms and tags management) and `/dispositivos/importar`; plan §6.5 updated. |
| Untrusted data (ADR-016) | ✔ | Limits, NFC normalization (new, M2-F1), CSV neutralization, escaped rendering. |
| Audit (constitution §6.6, P4) | ✔ strengthened | Change + audit in one transaction (M2-F2). Applies to all future services: write audit inside the change's transaction. |
| E2E harness (tasks M2-T13) | ✔ | CSP/console guard and axe active in CI. |

Rule added for later milestones: **every mutating service method records its audit entry in the
same transaction as the change** (pattern: public method wraps `<name>Tx` in `transaction`).
