# Phase 11 review — Senior Fullstack

Date: 2026-10-12 · Lens: buildable with the current stack, no new dependency.

- **F11-01 (MINOR)** The web API client only sends JSON. → add a raw-body upload helper
  (`application/octet-stream`) and a blob download for the export (POST, because the password is in
  the body). The CSRF Origin check already covers any content type.
- **F11-02 (MINOR)** Fastify's default body limit is 1 MB → the import route sets its own 50 MB
  limit and a content-type parser for `application/octet-stream` scoped to that route.
- **F11-03 (MINOR)** The standby banner joins the existing `GlobalBanners` (pause, dry-run, update)
  fed by `GET /api/migration/state`.
- **F11-04 (INFO)** `node:crypto` has `argon2` (Node 24, already used for logins) and AES-GCM;
  `node:zlib` gunzip with `maxOutputLength` gives the inflate guard (ADR-049) without streaming code.
- **F11-05 (INFO)** The CLI runs before the hub starts in `main.ts`; the export path opens the
  database with the same connection helper (WAL allows a reader next to the service).
