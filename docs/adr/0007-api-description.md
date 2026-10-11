# 0007 — One description of the API

- Status: Accepted, Oct 11, 2026
- Decisions: D92

Request and response shapes are zod schemas in `packages/api`; TypeScript types are inferred from them. Each `/api/v1`
endpoint is described once in `packages/api/src/routes.ts` (method, path, who may call it, body, success, errors).
From that list we generate `/api/v1/openapi.json` (OpenAPI 3.1, for integrations and the future MCP server) and the
`/docs/api` reference page. A test walks `app/api/v1` and fails if a route exists without a description or the other
way round, so the docs can't drift from the code.

Rejected: hand-written docs (drift), a heavy third-party docs viewer (extra dependency for a small page).
