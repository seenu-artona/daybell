# 0002 — Stack

- Status: Accepted, Oct 10, 2026
- Decisions: D7, D92, D96, D112, D113

| Area | Choice |
|---|---|
| Repo | Turborepo + pnpm workspaces |
| Web | Next.js + TypeScript (strict), Tailwind + shadcn/ui |
| Mobile tagging | Expo |
| Database and login | Supabase Postgres with row-level security; US and Canada (ca-central-1) projects |
| Photos | Cloudflare R2 (US) and AWS S3 ca-central-1 (Canada) behind one S3 interface |
| Payments | Stripe Connect destination charges, hosted Checkout, Stripe Tax |
| Background jobs | Trigger.dev, record IDs only |
| Email / SMS | Amazon SES / Telnyx |
| Hosting | Vercel (Montréal region for Canadian studios) |
| Lint + format | Biome (one fast tool; Next.js 16 no longer ships a lint command) |
| Tests | Vitest; Playwright for end-to-end |

Rejected: separate databases per studio (too costly to run), floats for money, ESLint + Prettier (two tools
where one does the job).
