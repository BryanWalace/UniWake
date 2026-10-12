# Phase 11 review — Code Reviewer

Date: 2026-10-12 · Lens: testability, traceability, security rules.

- **R11-01 (MINOR)** FR-402.1 (password length) had no AC → covered in AC-401-02 (refused short
  password) by the export tests; AC text extended.
- **R11-02 (MINOR)** Passwords must not reach logs or audit: request-body logging is already off;
  the audit records sections and mode only. Test asserts the password string is absent from logs
  and the audit export.
- **R11-03 (INFO)** Every AC is automatable except the owner's share/second-PC checklist (V4-T02),
  which repeats AC-403-06/AC-405-01 on real hardware.
- **R11-04 (INFO)** Route table authz test must list the six new admin routes.

## Consolidation (lead)
Accepted: A11-01, A11-02, D11-01, D11-02, D11-03 (spec/ADR/plan amended now), F11-01..03, D11-05,
R11-01, R11-02 (implementation tasks). **Gate passed: M21 may start.**
