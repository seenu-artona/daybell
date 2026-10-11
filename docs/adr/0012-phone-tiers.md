# 0012 — Phone tiers (D134)

- Status: Accepted, Oct 11, 2026. Amends D72 ("every screen works on phone").
- Decisions: D134 (Seenu, Oct 11 2026), D72, D91

**Two tiers.** The studio app no longer promises every screen on a phone.

| Tier | Screens | On a phone |
|---|---|---|
| Phone | Home, Orders, the job page, the roster view, adding and editing a child | Works fully. No horizontal page overflow; 44px targets (D91). |
| Desktop-only | Roster import, QR card printing, tagging review, price lists, Settings | Shows a short notice ("Open this on a computer to …") and a link back instead of the screen. Never a broken layout. |

**How.** A desktop-only screen keeps its back link and title, then wraps the rest in `DesktopOnly`
(`apps/web/app/app/desktop-only.tsx`). Below the `sm` breakpoint (640px) it shows an info banner with the screen's
notice, and the screen itself is `display: none`. From `sm` up it shows the screen. This is CSS only: no user-agent or
pointer sniffing, nothing to hydrate, and a tablet or a wide phone in landscape gets the full screen. Each notice is a
locale string on its screen, e.g. `app.roster.importPage.desktopOnly`. Links to desktop-only screens may stay visible
on phones, because they lead to the notice and not to a broken screen.

**Applied so far:** roster import (Phase 1 step 2). The other desktop-only screens adopt `DesktopOnly` when they are
built or next changed; Settings already exists and needs it in a later step.

**Tests.** The phone e2e project covers the phone tier and, for each desktop-only screen, checks that it shows the
notice. The desktop project covers the full flows. A phone guard checks that the job page never overflows sideways:
the roster table's `sr-only` header once escaped its scroll box and widened the page, and the fix is that `Table` is
`relative` (packages/ui).
