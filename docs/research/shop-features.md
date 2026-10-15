# Shop features: Shopify, GotPhoto and others vs what we've built

Research notes only, not decisions (CLAUDE.md rules 2 and 7). Collected Oct 14, 2026, from Shopify Help Center and shopify.dev, GotPhoto help, PhotoDay guides, ImageQuix and ShootProof docs, the Lifetouch Canada FAQ, and a read of our code on main. Points marked **[inference]** are ours, not stated by the source.

## The Shopify pattern that matters most

Shopify keeps the **shared definition** (the product, its variants, its base price) separate from the **context-specific override** (a catalog).

- A **catalog** is a **publication** (which products show) plus a **price list** (what they cost), attached to a context: a market, a B2B company location, or an app.
- A price list carries an overall **percentage adjustment** plus **fixed prices per variant**.
- Which price wins: a fixed price beats the percentage adjustment, which beats the base price. If several catalogs apply, the lowest price wins. Among markets, the most specific one wins.
- Overrides are edited on the context ("Manage products and pricing": a Price column, Included/Excluded tabs, quantity rules, volume pricing), never on the product page.
- Sources: https://shopify.dev/docs/apps/build/markets/catalogs-different-markets and https://help.shopify.com/en/manual/b2b/catalogs/creating-catalogs

GotPhoto has no per-job price override. A job swaps its whole price list, by hand or on a scheduled date (that is how early-bird pricing works), and an album can carry its own list. To change one price for one job, the studio duplicates the price list. Source: https://help.gotphoto.com/en/support/solutions/articles/103000252566-add-a-price-list-to-a-photo-job

## Feature checklist

| # | Feature | GotPhoto | Shopify | Ours (main, Oct 14) | Natural home **[inference]** |
|---|---|---|---|---|---|
| 1 | Price list per job | One per job, plus album override | Catalog per context | Built: the job swaps its whole list | Job › Shop |
| 2 | Change one price, or hide an item, for one job | Duplicate the list | Catalog fixed price, include/exclude | Missing | Job › Shop |
| 3 | Product only for one job | Duplicate the list | Publication | Missing | Job › Shop |
| 4 | % up or down for a whole job | No | Catalog adjustment | Missing | Job › Shop |
| 5 | Early bird, then regular price | Scheduled list switch | Rollouts, dated discounts | Missing | Job › Shop |
| 6 | Job coupon (tiers, minimum, deadline, one per code, free postage) | Yes | Discounts | Missing | Job › Shop |
| 7 | Sibling discount | Tiered job coupon + mixed-child package | Buy X get Y | Missing (siblings share a bag) | Job › Shop / price list |
| 8 | Studio-wide codes and vouchers | Custom vouchers | Discount codes | Missing | Shop › Promotions |
| 9 | Free or thank-you items (staff, coaches) | Workarounds | 100% code | Missing | Promotions |
| 10 | School (batch) vs home delivery, batch deadline | Per job | Shipping profiles, local pickup | Partial: toggle + one flat home fee per list | Job › Shop |
| 11 | Minimum order, package required | Per price list | Quantity rules | Missing (only Stripe's 50¢ minimum) | Price list |
| 12 | Upsells: extra poses, download with package | Per price list | Post-purchase offers | Missing | Price list |
| 13 | Backgrounds (surcharge), retouching | Per price list | Variants | Missing | Price list |
| 14 | Group photo products | "Available for: group photos" per item | — | Decided (D156: same products), not built | Price list / shop |
| 15 | Prepay before picture day | Separate prepay list | — | Missing | Job › Shop |
| 16 | Yearbook pose selection (1–2 poses, deadline) | Per job | — | Soon step only | Job (Progress / Subjects) |
| 17 | Order deadline, archive, reorders after close | Per job | — | Partial: closing date; no reorders | Progress |
| 18 | Late-order fee | Not found | — | Missing | Job › Shop **[inference: rare]** |
| 19 | Cart reminders (1, 3, 24 h) | Account | Automations | Missing | Settings › Messages |
| 20 | Reminder campaigns per job | Per job | Automations | Soon (template Messages) | Templates |
| 21 | Gift cards | Not found | Yes | Missing | Later |
| 22 | More print sizes, finishes, options | Yes | Variants | Fixed 5 sizes | Products |
| 23 | Lab integration, cost price floor | Yes | — | Missing (out of scope, ADR 0019) | Later |
| 24 | Sales reports by job, product, discount | Statistics tab | Reports | Partial (Overview cards) | Analytics |
| 25 | Preview the shop as a parent | — | Theme preview | Soon | ⋯ More |

## What GotPhoto lets a studio set per job (top 15, ranked by the researcher **[inference]**)

1. Price list (and album overrides)
2. Order deadline
3. Archive or keep open (reorders)
4. Early-bird date (scheduled list switch)
5. Job coupon: type, tiers, minimum, deadline, one per code
6. Whether studio-wide codes work in this job
7. School vs home delivery, batch deadline
8. Free shipping
9. Prepay: on or off, its own list, deadline
10. Yearbook selection: number of poses, instructions, deadline
11. Sibling handling
12. Minimum order or package required
13. Reminder campaign
14. Free or thank-you items
15. Retake or makeup day handling

## Sources (opened)

- Shopify:
  - https://help.shopify.com/en/manual/products/details/product-details-page
  - https://help.shopify.com/en/manual/products/bundles/shopify-bundles
  - https://shopify.dev/docs/apps/build/markets/catalogs-different-markets
  - https://help.shopify.com/en/manual/b2b/catalogs/creating-catalogs
  - https://help.shopify.com/en/manual/b2b/catalogs/quantity-pricing
  - https://help.shopify.com/en/manual/markets
  - https://help.shopify.com/en/manual/discounts/discount-types/percentage-fixed-amount
  - https://help.shopify.com/manual/discounts/discount-combinations
  - https://help.shopify.com/en/manual/orders/abandoned-checkouts
  - https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/pickup-in-store
  - https://shopify.dev/docs/apps/build/checkout/product-offers/post-purchase
- GotPhoto:
  - https://help.gotphoto.com/en/support/solutions/articles/103000249954-create-a-price-list
  - https://help.gotphoto.com/en/support/solutions/articles/103000251069
  - https://help.gotphoto.com/en/support/solutions/articles/103000251163-set-up-batch-shipping
  - https://help.gotphoto.com/en/support/solutions/articles/103000249958-create-a-price-list-prepay-
  - https://help.gotphoto.com/en/support/solutions/articles/103000255029-set-up-gotphoto-s-background-feature
  - https://help.gotphoto.com/en/support/solutions/articles/103000362917-use-automated-abandoned-cart-reminders
- PhotoDay:
  - https://photoday.com/photoday-guide/creating-price-sheets
  - https://photoday.com/photoday-guide/advancepay
  - https://photoday.com/updates/job-specific-offers
  - https://photoday.com/private-gallery-guide/using-yearbook-selection
- ImageQuix: https://help.imagequix.com/en/articles/3136028-yearbook-selection-tool
- ShootProof: https://developer.shootproof.com/reference/studio/events/
- Lifetouch Canada: https://lifetouch.ca/school-picture-faqs/
