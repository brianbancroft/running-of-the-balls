# Running of the Balls

An open-source system for the Ladysmith Kinsmen Running of the Balls fundraiser.

This repository is a local demonstration scaffold. It is not a live gaming site, it does not take payment, and it is not a British Columbia charitable gaming licence. A live club event would need that licence before any real money is taken. Nothing below is legal advice.

## What you can click through

Four flows share one Worker, one D1 database, and the static pages in `public/`:

1. **Purchase engine.** The home board lets a buyer hold a specific ball when picking is on, then confirm a demo record. Confirmation writes a fake Stripe test reference and does not call Stripe.
2. **Customer purchase view.** `/purchase.html` looks up demo purchases for one email.
3. **Email and ball records.** `/selections.html` lists the stored link between that email and each ball they selected, including cancelled holds.
4. **Admin offline sales.** `/admin.html` records a club-table ball as an offline demo sale. It requires `ADMIN_TOKEN` and still does not collect money.

Held and sold balls are shaded on the scrolling marquee and on the board. Open balls can be picked when `ALLOW_BALL_PICKING` is `true`.

## Stack

- Cloudflare Workers, with static assets served by the same Worker
- [Hono](https://hono.dev/docs/getting-started/cloudflare-workers) for routes
- D1 (SQLite) for balls, purchases, email-and-ball selections, and email dispatch rows
- [Resend](https://resend.com/docs) for the buyer receipt hook
- TypeScript for the Worker and the browser client
- `wrangler.jsonc`, `compatibility_date` `2026-11-11`, `nodejs_compat`

Stripe is not a dependency. The online confirm path stores a `cs_test_fake_…` reference and refuses `sk_live_` / `rk_live_` / `pk_live_` keys. Email delivery defaults to `dry_run`, so a Resend key is not used unless `EMAIL_DELIVERY` is changed to `resend` on purpose.

## Run locally

```bash
npm ci
npm run d1:migrate:local
npm run dev
```

Open `http://localhost:8787`.

`npm run check` regenerates binding types, typechecks the Worker, client, and tests, checks dependency licenses, and runs the Workers Vitest suite. No Cloudflare account, remote database, or API key is required.

To try offline sales, copy the example env file and set a token only on your machine:

```bash
cp .dev.vars.example .dev.vars
# then set ADMIN_TOKEN in .dev.vars
```

`.dev.vars` is gitignored. Do not commit it.

The D1 `database_id` in `wrangler.jsonc` is a local placeholder. It does not create a remote database. Do not run `wrangler deploy`, `wrangler d1 create`, or `wrangler secret put` from this setup. `wrangler secret put` publishes a Worker version. Replace the placeholder id only when a deployment is an intentional later step, the club has the right to take money, and Cloudflare’s current service terms have been reviewed.

## Project layout

| Path | Role |
| --- | --- |
| `wrangler.jsonc` | Worker config, assets, D1 binding, non-secret vars, secret names |
| `src/index.ts` | Worker entry |
| `src/app.ts` | Hono routes for the four flows |
| `src/purchase-engine.ts` | Holds, demo confirm, cancel, offline sales, purchase and selection queries |
| `src/email/deliver.ts` | Dry-run by default; Resend only when delivery is switched on and a key exists |
| `src/payments/stripe-test.ts` | Fake test-mode reference. No Stripe HTTP call |
| `src/client/app.ts` | Browser UI, compiled to `public/app.js` |
| `public/index.html` | Purchase board |
| `public/purchase.html` | Customer purchase view |
| `public/selections.html` | Email-and-ball records |
| `public/admin.html` | Offline demo sales |
| `migrations/0001_init.sql` | D1 schema |
| `migrations/0002_seed.sql` | Sample balls, including held, sold, and one offline record |
| `.dev.vars.example` | Secret names only. Placeholders are not keys |
| `THIRD_PARTY_LICENSES.md` | Recorded dependency licenses |
| `LICENSE` | MIT |

API routes:

| Route | Flow |
| --- | --- |
| `POST /api/selections` | Purchase engine: hold a ball and store the email-and-ball row |
| `POST /api/purchases/:id/confirm-demo` | Purchase engine: confirm without charging, then the email hook |
| `POST /api/purchases/:id/cancel` | Release a hold. The email-and-ball row stays |
| `GET /api/purchases?email=` | Customer purchase view |
| `GET /api/selections?email=` | Email-and-ball records for that address |
| `POST /api/admin/offline-sales` | Admin offline demo sale. `Authorization: Bearer` token |
| `GET /api/admin/sales` | Recent records for the admin page |

## Compliance

This section is a constraint for later work. It is not legal advice.

### Not licensed for live play

Running of the Balls, as a service-club fundraiser, is the kind of charitable gaming event that needs a licence before real money changes hands. This demo:

- does not run a draw
- does not sell entries
- does not call Stripe
- does not send buyer email unless a later change turns delivery on
- labels amounts as demonstration figures
- keeps `demo_only` forced on in the database
- allows only `stripe_test_fake` and `offline_demo` as payment markers

A live Ladysmith Kinsmen event needs the appropriate British Columbia charitable gaming licence before any real money is taken. Public licensing information is published by the Province of British Columbia (Gaming Policy and Enforcement Branch). The club’s own counsel, not this repository, is the place to confirm what a particular event requires.

### Cloudflare Workers

The Workers runtime (`workerd`) is Apache-2.0. Using the hosted Cloudflare service is a separate matter and is governed by Cloudflare’s current service terms, including the [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) where that agreement applies. Customer code stays the customer’s content, and you still need the rights to that code and its dependencies. Review the current agreement before deploying. This scaffold does not deploy itself.

### Dependency licenses

Direct dependencies must be OSI-approved and commercially usable in an open-source app on Workers. Preferred licenses are MIT, Apache-2.0, BSD, and ISC. Do not add AGPL, SSPL, Commons Clause, Business Source, non-commercial, or other terms that conflict with this MIT distribution or with running the app as a Worker. `npm run licenses` rewrites `THIRD_PARTY_LICENSES.md` and fails if a package falls outside that policy.

Buyer email in a real send would also need the club’s identification and a current postal address. The dry-run receipt names Ladysmith, British Columbia, and says no further demo messages are sent. It is a preview, not a mailing.
