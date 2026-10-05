# M6 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-05

| Plan item | Status | Note |
|---|---|---|
| Permission matrix (FR-006.2, IMP-014) | ✔ | Route levels derived from the matrix in a test, plus the existing dynamic 401/403 check. |
| LAN HTTPS (ADR-012, ADR-026) | ✔ | Separate TLS listener, PowerShell-generated or uploaded PFX, Secure cookies; failures degrade to loopback with a notice. LAN keys are restart-required. |
| Settings runtime application (NFR-03) | ✔ | DB keys read at use; bootstrap keys in config.json (atomic write, BOM tolerant); audited diff. |
| Health (FR-012) | ✔ | Slow checks behind ports (TimeCheck, HostChecks) created only by `main.ts`; no network or process spawn in tests. |
| Backups (FR-014, IMP-010) | ✔ | VACUUM INTO; restore swap at start-up because Windows locks the open file; exit 75 asks the service manager for a restart (ADR-021 recovery). |
| Error catalog | changed | `LAST_ADMIN` added (plan §6.6). |
| Layering | ✔ | File access stays in adapters/db; HTTP reaches logs and certificates through ports on the services. |

No plan change needed. M7 may start.
