# M2 review — Code Reviewer

Milestone: **M2 Devices, Rooms, Tags** (M2-T01..T14, M2-D, M2-F1..F2) · Date: 2026-10-04
Evidence: `npm run verify` green (231 tests), Playwright E2E 7/7 (CI green on ubuntu + windows),
core coverage 97.3% stmts / 89.0% branches / 97.4% funcs / 98.4% lines.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-002.1–.3 and FR-008.1–.3: AC-002-01..11, AC-008-01..05 have tests (API, component, E2E). |
| Scoping server-side | n/a | M3. Room/tag membership is validated server-side (unknown ids → 422). |
| Tests | ✔ | API tests per AC, CSV round trip across two databases, 500-device benchmark, crash-during-import, E2E with CSP/console guard and axe. |
| Security | ✔ | Every route declares auth (route-table test now includes `GET /*`); CSV formula neutralization; text NFC-normalized; HTML stored as text and rendered escaped; no `dangerouslySetInnerHTML`; static files cannot escape the web dir; bulk delete requires `confirm: true`. |
| Reliability | ✔ | Bulk and import are all-or-nothing; audit atomic with changes (M2-F2). |
| Code | ✔ | Boundaries respected; repositories behind application interfaces. |
| UI | ✔ | pt-BR, loading/empty/error states, confirmations with counts, focusable dialogs, one h1 per page (fixed during M2-T14). |

## Findings
No CRITICAL or MAJOR findings are open (M2-F1/F2 were MAJOR and are fixed).

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M2-01 | MINOR | `http/app.ts` | Framework-level errors raised before routing (e.g. malformed `%` escapes → `FST_ERR_BAD_URL`) bypass the error handler and return Fastify's English body, not `{code, message}` (ADR-006). | `frameworkErrors` handler mapping to `VALIDATION_FAILED`. | M2-F3 |
| R-M2-02 | MINOR | `http/routes/devices.ts` | Export filename date uses UTC; after 21:00 in São Paulo the file carries tomorrow's date. | Use the configured time zone. | M2-F4 |
| R-M2-03 | MINOR | `DevicesPage.tsx` | Search fires a request on every keystroke and resets selection each time. | Debounce 250 ms. | M2-F5 |
| R-M2-04 | MINOR | `RoomPage.tsx` | The room page loads at most 200 devices and silently hides the rest. | Show "mostrando X de Y" with a link to the filtered device list. | M2-F6 |
| R-M2-05 | MINOR | `http/errors.ts` | A `ForeignKeyError` (only reachable if a future path skips `checkRefs`) would surface as 500. | Map to 422 `VALIDATION_FAILED` as a safety net. | M2-F7 |
| R-M2-06 | SUGGESTION | `GET /api/devices` | Returns two shapes depending on `all=1`. | Acceptable; revisit if clients multiply. | — |
| R-M2-07 | SUGGESTION | Room code edit | Changing a room code invalidates enrollment commands already handed out. | Warn when editing the code while tokens are active (M7-T07). | M7-T07 |
