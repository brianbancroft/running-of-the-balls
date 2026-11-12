# Running of the Balls

An open-source system for the Ladysmith Kinsmen Running of the Balls fundraiser.

This repository is a local demonstration scaffold. It is not a live gaming site, it does not take payment, and it is not a British Columbia charitable gaming licence. A live club event would need that licence before any real money is taken. Nothing below is legal advice.

## What you can click through

Four flows share one Worker, one D1 database, and the static pages in `public/`:

1. **Purchase engine.** On `/`, a buyer picks a specific open ball, enters a name and email, and buys it in one step. The ball locks to sold inside one D1 batch, so a second buy of that ball is rejected. The same buyer can check out as many open balls as they want. The purchase stores a fake Stripe test reference and does not call Stripe. Each purchase gets an unguessable receipt token.
2. **Customer purchase view.** Checkout returns that token and puts it in the receipt. `/purchase?token=` opens that one purchase. Typing someone else's email does not list their balls or the stored receipt.
3. **Email and ball records.** Every buy writes `ball_selections` (email plus ball) and `email_dispatches` (the receipt subject and body, beside that ball). With no `RESEND_API_KEY`, or while `EMAIL_DELIVERY` is `dry_run`, the row is still stored and nothing is sent. `/selections` shows those rows, including the receipt text, and only for an admin.
4. **Admin offline sales.** `/admin` lets an administrator pick a ball for a name and email. It uses the same lock, purchase row, receipt token, and email-and-ball row as an online buy, with `payment_mode` `offline_demo`. The page prefers a Google sign-in whose email is listed in `ADMIN_EMAILS`. `Authorization: Bearer` matching `ADMIN_TOKEN` still authorizes the admin API. Buyers do not sign in with Google to purchase a ball.

The catalogue is 2,500 balls, numbered from 1. That numbering is still a placeholder. Held and sold balls are shaded on the scrolling marquee and on the board. The marquee draws a sample, and the picker shows one block of 100 at a time. Open balls can be picked when `ALLOW_BALL_PICKING` is `true`. A buyer can take as many balls as remain free. Price, prizes, bundles, and whether a buyer picks a number or is assigned one are still undecided. The page describes a fundraiser for the Kinsmen Club of Ladysmith for an upcoming infrastructure project.

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

### Try each flow

1. **Buy a ball.** On `/`, click a bright ball in the marquee (or open `/pick`). Arrow keys move between balls. Continue to checkout, enter an email, and choose the test pay button. The card fields are disabled placeholders. The ball locks. Buying it again returns a conflict. Nothing is charged. The confirmation page links to a receipt for each ball. Set `ALLOW_BALL_PICKING` to `false` and restart to try the quantity field instead. It has no cap other than how many balls are still free.
2. **See a purchase.** Open the receipt link from checkout, or paste it on `/purchase`. A seeded sample, which is public demo data already in the migrations, is `/purchase?token=390822ccb06855179424236c3774f960118070866e3030acb0808837a6ca55d3` (ball 3). That link does not reveal the other seeded purchases.
3. **See the email record.** The buyer's receipt link includes the stored receipt text. `/selections` lists every email-and-ball row for an address, including that text, and asks for the same admin sign-in as offline sales. The receipt stays in D1 even when Resend is not called.
4. **Record an offline sale.** Either set `ADMIN_TOKEN` in `.dev.vars` and enter it on `/admin`, or set `ADMIN_EMAILS` plus the Google sign-in secrets below and sign in with a listed account. Enter a free ball number and a name and email. That ball locks the same way as an online buy, including when both are attempted together. A buyer can still check out with only the email on the purchase form.

```bash
curl -s -X POST http://127.0.0.1:8787/api/purchases \
  -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","buyerName":"Ada","ballId":12}'
```

To try offline sales, copy the example env file and set a token only on your machine:

```bash
cp .dev.vars.example .dev.vars
# then set ADMIN_TOKEN in .dev.vars
# Google sign-in also needs ADMIN_EMAILS, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET, and SESSION_SECRET. Leave them blank to keep it off.
```

`.dev.vars` is gitignored. Do not commit it.

The D1 `database_id` in `wrangler.jsonc` is a local placeholder. It does not create a remote database. Nothing in this repository deploys, registers a domain, or changes DNS.

## Deploy checklist

This is what Brian would provide before a hosted demo. It is not done here.

1. A Cloudflare account, and a review of Cloudflare’s current service terms, including the Self-Serve Subscription Agreement where it applies.
2. A D1 database created with `wrangler d1 create`, then the printed `database_id` pasted over the placeholder in `wrangler.jsonc`. Apply the checked-in migrations to that database only when a deploy is intended.
3. Wrangler secrets, set outside git. `wrangler secret put` publishes a Worker version, so treat it as a deploy. The names are `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `ADMIN_TOKEN`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`. `STRIPE_SECRET_KEY` must stay empty or be a Stripe test key (`sk_test_`). Never put a live key (`sk_live_`, `rk_live_`, `pk_live_`) in the Worker. Leave `EMAIL_DELIVERY` as `dry_run` until a real Resend send is an intentional change. `ALLOW_BALL_PICKING` is a plain var, not a secret: `true` lets buyers pick a number, `false` assigns an open ball at random. `ADMIN_EMAILS` is a comma-separated list of Google account emails (trimmed, compared without case). An empty list means nobody is an admin via Google. `ADMIN_TOKEN` remains the API fallback.
4. A Google Cloud OAuth web client, only if admin sign-in should be on. Register both callback URLs: `http://localhost:8787/api/auth/google/callback` for local `wrangler dev`, and `https://balls.bancroft.io/api/auth/google/callback` for the future demo host. Also register the JavaScript origins `http://localhost:8787` and `https://balls.bancroft.io`. Put the client id, client secret, and a long random `SESSION_SECRET` in the secrets above. If those values are missing, `/api/auth/google` answers 503 and `/admin` keeps the token field. This repository does not create the Google client, deploy the Worker, or change DNS.
5. DNS for `balls.bancroft.io`, on the Cloudflare zone Brian already controls, pointing at this Worker. Do not buy a domain for this demo. The callback URL above is documentation for that future host. Nothing here points DNS at it.
6. The appropriate British Columbia charitable gaming licence before any real money is taken. Until then the hosted copy stays a demonstration: test markers, no live charge, placeholder prices and prizes.
7. Official Kin Canada and Kinsmen Club of Ladysmith marks are in `public/marks/` for this demo. Permission to use them here is granted. They are trademarks of Kin Canada and the Kinsmen Club of Ladysmith and are not covered by the MIT license.

## Project layout

| Path | Role |
| --- | --- |
| `wrangler.jsonc` | Worker config, assets, D1 binding, non-secret vars, secret names |
| `src/index.ts` | Worker entry |
| `src/app.ts` | Hono routes for the four flows and Google sign-in |
| `src/auth.ts` | Admin token fallback and Google admin check |
| `src/google-auth.ts` | Google OAuth start, callback, and sign-out |
| `src/session.ts` | Signed session cookie |
| `src/purchase-engine.ts` | Buy, hold, confirm, offline sale, and the email-and-ball queries |
| `migrations/0003_email_records.sql` | Stores receipt subject and body on the email row, with the ball id |
| `src/email/deliver.ts` | Dry-run by default; Resend only when delivery is switched on and a key exists |
| `src/payments/stripe-test.ts` | Fake test-mode reference. No Stripe HTTP call |
| `src/client/app.ts` | Browser UI, compiled to `public/app.js` |
| `public/index.html` | Home marquee, pick or quantity, prizes |
| `public/pick.html` | Picker grid, find-by-number, blocks of 100 |
| `public/checkout.html` | Stripe test-mode checkout |
| `public/confirmation.html` | Test receipt |
| `public/styles.css` | Kin red / navy tokens and ball states |
| `public/purchase.html` | One purchase, opened with its receipt token |
| `public/selections.html` | Admin email-and-ball records |
| `public/admin.html` | Offline demo sales |
| `migrations/0001_init.sql` | D1 schema |
| `migrations/0002_seed.sql` | Sample balls, including held, sold, and one offline record |
| `migrations/0005_catalogue_2500.sql` | Extends the demo catalogue from 1,000 balls to 2,500, then adds the receipt token |
| `.dev.vars.example` | Secret names only. Placeholders are not keys |
| `THIRD_PARTY_LICENSES.md` | Recorded dependency licenses |
| `LICENSE` | MIT |

API routes:

| Route | Flow |
| --- | --- |
| `POST /api/purchases` | Purchase engine: buy a specific ball, lock it, store the receipt |
| `POST /api/selections` | Optional hold. The ball locks as selected until confirm or cancel |
| `POST /api/purchases/:id/confirm-demo` | Confirm a hold without charging, then the email hook |
| `POST /api/purchases/:id/cancel` | Release a hold. The email-and-ball row stays |
| `GET /api/balls` | Ball id, number, and status for the 2,500-ball catalogue. No buyer email |
| `GET /api/purchases?token=` | One purchase for that receipt token. Email is not a lookup |
| `GET /api/selections?email=` | Email-and-ball records, admin only. Same data as the route below |
| `GET /api/admin/selections?email=` | Email-and-ball records for an admin, including receipt text |
| `GET /api/auth/session` | Current Google session, if any. Does not require sign-in |
| `GET /api/auth/google` | Start Google sign-in. 503 when the client is not configured |
| `GET /api/auth/google/callback` | Google redirects here. Local: `http://localhost:8787/api/auth/google/callback`. Future host: `https://balls.bancroft.io/api/auth/google/callback` |
| `POST /api/auth/logout` | Clear the session cookie |
| `POST /api/admin/offline-sales` | Admin offline demo sale. Google admin session, or `Authorization: Bearer` token |
| `GET /api/admin/sales` | Recent records for an admin |

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

### Brand marks

Permission to use the official Kin Canada and Kinsmen Club of Ladysmith marks on this open-source demo is granted. The header uses `public/marks/kinsmen-club-of-ladysmith-trim.png` on white. The navy footer uses `public/marks/kin-canada-emblem.png` and credits Ladysmith Kinsmen / Kin Canada.

Those marks are trademarks of Kin Canada and the Kinsmen Club of Ladysmith. They are not licensed under the MIT license that covers the rest of this repository. Do not treat the MIT grant as permission to reuse the marks.

### Dependency licenses

Direct dependencies must be OSI-approved and commercially usable in an open-source app on Workers. Preferred licenses are MIT, Apache-2.0, BSD, and ISC. Do not add AGPL, SSPL, Commons Clause, Business Source, non-commercial, or other terms that conflict with this MIT distribution or with running the app as a Worker. `npm run licenses` rewrites `THIRD_PARTY_LICENSES.md` and fails if a package falls outside that policy.

Buyer email in a real send would also need the club’s identification and a current postal address. The dry-run receipt names Ladysmith, British Columbia, and says no further demo messages are sent. It is a preview, not a mailing.
