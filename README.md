# Running of the Balls

An open-source system for the Ladysmith Kinsmen Running of the Balls fundraiser.

The demonstration is hosted at [https://balls.bancroft.io](https://balls.bancroft.io). It is not a licensed gaming site, it does not take payment, and it is not a British Columbia charitable gaming licence. A live club event would need that licence before any real money is taken. Nothing below is legal advice. A push to this repository does not update the hosted demo.

Operators setting up Cloudflare, Resend, or an admin sale should read [docs/OPERATIONS.md](docs/OPERATIONS.md).

## What you can click through

Four flows share one Worker, one D1 database, and the static pages in `public/`:

1. **Purchase engine.** On `/`, a buyer picks a specific open ball. That pick is a reservation hold: the ball stays out of the pit while they pay, and it is not a sale yet. The five minutes start when that browser holds its first ball. Every later ball in the same reservation shares that deadline. Checkout asks the buyer to confirm they are 19 or older and physically in British Columbia, and stores that attestation on the purchase. Paying converts the holds in the order into demo purchases and releases any other holds from that reservation. If one ball in that order cannot be recorded, the checkout keeps none of them: balls already written in that attempt go back to held, and the reservation stays open. If the five minutes pass first, the holds expire and the balls go back in the pit. That sweep runs on API requests and on the Worker cron trigger `* * * * *` in `wrangler.jsonc`, so a closed tab does not leave a ball stuck. Deploying the Worker is what installs that trigger. A purchase locks the ball to sold inside one D1 batch, so a second buy of that ball is rejected. The same buyer can check out as many open balls as they want. One reservation can hold 40 balls that are not paid yet. One network address can have 120 unpaid balls at once, counting those reservation holds and the optional hold from `POST /api/selections`. Paying, releasing a ball, or waiting out the five minutes frees that room, and the same buyer can hold more. The network limit uses the address Cloudflare sends (`CF-Connecting-IP`), stored as a short hash, and it is not applied when that address is missing. The optional hold also ends after five minutes when that address is present. The seeded sample holds on balls 6 and 14 stay on the board. The purchase stores a fake Stripe test reference and does not call Stripe. Each purchase gets an unguessable receipt token.
2. **Customer purchase view.** Checkout returns that token and puts it in the receipt. `/purchase?token=` opens that one confirmed purchase. The same page, for this browser, lists confirmed balls from the reservation and, while a hold is still pending payment, the held balls and the time left. Expired and released holds are not shown as owned. Typing someone else's email does not list their balls or the stored receipt.
3. **Email and ball records.** Every buy writes `ball_selections` (email plus ball) and `email_dispatches` (the receipt subject and body, beside that ball). With no `RESEND_API_KEY`, or while `EMAIL_DELIVERY` is `dry_run`, the row is still stored and nothing is sent. `/selections` shows those rows, including the receipt text, and only for an admin.
4. **Admin offline sales.** `/admin` lets an administrator pick a ball for a name and email, after recording that the buyer confirmed they are 19 or older and physically in British Columbia. It uses the same lock, purchase row, receipt token, and email-and-ball row as an online buy, with `payment_mode` `offline_demo`. A ball another buyer currently holds (`pending_payment`) is refused. A ball whose five minutes have passed can be recorded, and that sale stores the ball on the email row the same way an online purchase does. An online checkout and an offline sale of the same ball cannot both succeed, and neither can two holds. The attestation is stored with `attested_by` `admin`. The page prefers a Google sign-in whose email is listed in `ADMIN_EMAILS`. `Authorization: Bearer` matching `ADMIN_TOKEN` still authorizes the admin API. A state-changing admin action that uses the Google session cookie has to come from this site: the browser sends `Origin` on that request, and a form on another site cannot set it to this host. A bearer token is not a browser cookie, so a token client does not send `Origin`. The pages send `Referrer-Policy: no-referrer` and refuse to be framed. Buyers do not sign in with Google to purchase a ball.

An admin can void a mistaken sale, online or offline. The reason is required. The purchase stays in the customer receipt and in `/selections`, marked voided, and is not deleted. The same write puts the ball back in the pit and stores an audit row: who, when, why, which ball, and the original purchase. A token admin is recorded as `admin-token` (the token itself is not stored). A Google admin is recorded as that account's email. The ball can be held or sold again through the online path or the offline path. A second void of the same sale is refused. A hold that was never paid is not a sale, so it cannot be voided this way.

The same admin sign-in downloads three CSV files: purchases (payment mode, the 19+ and in-BC attestation, and void status), ball selections, and email dispatches. Receipt tokens are left out of those files. A receipt link inside a stored email is written as `token=redacted`. The admin page still shows the receipt text, including the link, to a signed-in admin. A cell that a spreadsheet would treat as a formula, including one that starts with a tab or a carriage return, is prefixed so it stays text. Request logs omit the query string, and a 64-character receipt token in a log field is replaced before it is written.

The catalogue is 2,500 balls. That count is confirmed and is the rows in `balls`, not a var. There is no cap on how many of those balls one checkout may buy. The page describes a fundraiser for the Kinsmen Club of Ladysmith for an upcoming infrastructure project. That sentence is confirmed. It is not an approval to spend gaming proceeds.

Numbering, the ticket price, bundles, whether a buyer picks a ball or is assigned one, and this year's prizes are still unconfirmed. They are plain vars in `wrangler.jsonc`, read in `src/config.ts`, with safe demo defaults. Each decision has its own `*_CONFIRMED` flag. Only the exact string `true` confirms that decision. The pages and the stored receipt keep a "pending a decision" label for each flag that is still `false`. Setting the value does not remove the label. Confirming a price or a prize list does not take a payment and does not make the value a licence term.

| Value | Demo default | Confirmed flag | Pending decision |
| --- | --- | --- | --- |
| `BALL_NUMBERING` | `sequential_from_1` | `BALL_NUMBERING_CONFIRMED` | How balls are numbered. This is the only scheme implemented. It matches the seeded integers 1 through 2500 and does not renumber them. Any other value refuses to start. Confirming it does not turn on another scheme. |
| `BALL_NUMBER_PAD` | `3` | `BALL_NUMBER_PAD_CONFIRMED` | The public label. Ball 7 is shown as `007` on the page and in the receipt subject. `0` shows `7`. CSV files keep the integer. |
| `DEMO_AMOUNT_CENTS` | `500` | `DEMO_AMOUNT_CONFIRMED` | Placeholder price for one ball, in Canadian cents. $5.00 is not a ticket price. Confirming it does not charge a card. |
| `BALL_BUNDLES` | `[]` | `BALL_BUNDLES_CONFIRMED` | No bundles. An entry is a quantity at that same placeholder price, such as `{"quantity":5,"label":"Five balls"}`. It cannot carry its own price. |
| `ALLOW_BALL_PICKING` | `true` | `BALL_ASSIGNMENT_CONFIRMED` | When a buyer may pick a specific ball. `true` allows it for the whole demo. `false` assigns an open ball and refuses a chosen number, including a reservation hold. There is no sale window. |
| `PRIZE_PODIUM` | past-year `$500`, `$300`, `$100` | `PRIZES_CONFIRMED` | JSON list of `{place, amount}` display text, at most 8. The default is flavour from past years, labelled "Placeholder · prizes TBA", and is not this year's prize list. `[]` lists none. An entry cannot carry odds or claim rules. |

`GAMING_LICENCE_NUMBER` is separate. Empty shows "Demo, no licence. No real tickets are sold." on the rules page and in the footer. A number shows as `BC Gaming Event Licence #` plus that number. Do not invent one. There is no confirmed flag: empty is the unlicensed state.

Held and sold balls are shaded on the scrolling marquee and on the board, and the picker writes Held or Sold on the ball as well as in its name for a screen reader. Open balls are named open. Arrow keys move between balls. The marquee stops when the browser asks for reduced motion. The pages stack on a phone. The marquee draws a sample, and the picker shows one block of 100 at a time. A buyer can take as many balls as remain free.

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

`npm run check` compiles `src/client` into `public`, regenerates binding types, typechecks the Worker, client, and tests, checks dependency licenses, and runs the Workers Vitest suite. No Cloudflare account, remote database, or API key is required. `npm run licenses -- --check` does that license check without rewriting `THIRD_PARTY_LICENSES.md`. A push to `main` runs install, typecheck, tests, and that check on a free GitHub-hosted runner (`.github/workflows/ci.yml`).

### Try each flow

1. **Buy a ball.** On `/`, click a bright ball in the marquee (or open `/pick`). That ball is held for you. Arrow keys move between balls. The five minutes start on the first ball you hold, and the page counts them down. Continue to checkout, enter an email, check the 19+ and in-BC box, and choose the test pay button. The purchase is refused without that box, and it is refused if the five minutes have run out. The card fields are disabled placeholders. Each unconfirmed decision is labelled pending. Set that decision's `*_CONFIRMED` var to `true` and restart to hide its label. Paying records the balls you are paying for and releases any other balls that reservation still held. If one of the balls you are paying for cannot be recorded, none of that checkout is kept. Buying a held or recorded ball again returns a conflict. Nothing is charged. The confirmation page links to a receipt for each ball. Set `ALLOW_BALL_PICKING` to `false` and restart to try the quantity field instead. It has no cap other than how many balls are still free, it does not open a reservation, and a request that names a ball is refused.
2. **See a purchase.** Open the receipt link from checkout, or paste it on `/purchase`. A seeded sample, which is public demo data already in the migrations, is `/purchase?token=390822ccb06855179424236c3774f960118070866e3030acb0808837a6ca55d3` (ball 3). That link does not reveal the other seeded purchases. If an admin voids that purchase, the same link still opens it and says the sale was voided and the ball is back in the pit.
3. **See the email record.** The buyer's receipt link includes the stored receipt text. `/selections` lists every email-and-ball row for an address, including that text, and asks for the same admin sign-in as offline sales. The receipt stays in D1 even when Resend is not called.
4. **Record an offline sale.** Either set `ADMIN_TOKEN` in `.dev.vars` and enter it on `/admin`, or set `ADMIN_EMAILS` plus the Google sign-in secrets below and sign in with a listed account. Enter a free ball number and a name and email. That ball locks the same way as an online buy, including when both are attempted together. A ball that is still inside someone else's five minutes is refused. After those five minutes, the same ball can be recorded. A buyer can still check out with only the email on the purchase form. To undo a mistaken record, enter its purchase id and a reason and void it. The ball is free again. The same page downloads the purchases, ball selections, and email dispatches as CSV.

The same online purchase from the shell has to send the attestation. `attestAge19` and `attestInBc` are JSON booleans. Without both set to `true`, the Worker refuses the purchase:

```bash
curl -s -X POST http://127.0.0.1:8787/api/purchases \
  -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","buyerName":"Ada","ballId":12,"attestAge19":true,"attestInBc":true}'
```

To try offline sales, copy the example env file and set a token only on your machine:

```bash
cp .dev.vars.example .dev.vars
# then set ADMIN_TOKEN in .dev.vars
# Google sign-in also needs ADMIN_EMAILS, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET, and SESSION_SECRET. Leave them blank to keep it off.
```

`.dev.vars` is gitignored. Do not commit it.

The Worker `running-of-the-balls` is hosted on Cloudflare, bound to the D1 database named in `wrangler.jsonc`. The public demo is [https://balls.bancroft.io](https://balls.bancroft.io). This repository does not register a domain or change DNS, and it does not deploy itself.

## Deploy checklist

The Worker, its D1 database, and [https://balls.bancroft.io](https://balls.bancroft.io) are already hosted. What is still outstanding is below.

1. A Cloudflare account, and a review of Cloudflare’s current service terms, including the Self-Serve Subscription Agreement where it applies. Done for this demo.
2. A D1 database for the Worker, with the `database_id` in `wrangler.jsonc`. Migrations through `0006` are on the hosted database. `migrations/0007_reservation_holds.sql`, `migrations/0008_sale_voids.sql`, and `migrations/0009_hold_client.sql` are not applied by a push to this repository. An operator has to apply them to the hosted D1 before the hold, void, and unpaid-hold limit code is deployed: `npx wrangler d1 migrations apply running-of-the-balls --remote`. A Worker that uses reservation holds fails to select a ball until `0007` is on the hosted database. A Worker that voids a sale fails until `0008` is on the hosted database. A Worker that enforces the unpaid-hold limit fails to hold a ball until `0009` is on the hosted database. This repository does not run that command.
3. The Worker cron trigger `* * * * *` in `wrangler.jsonc` (`triggers.crons`). It calls `expireDueHolds` every minute, including when the buyer's tab is closed. API requests sweep as well, so a visitor does not wait for the next minute. The trigger is installed when the Worker is deployed. This repository does not deploy.
4. Wrangler secrets, set outside git. `wrangler secret put` publishes a Worker version, so treat it as a deploy. The names are `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `ADMIN_TOKEN`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`. `STRIPE_SECRET_KEY` must stay empty or be a Stripe test key (`sk_test_` or `rk_test_`). The Worker does not call Stripe and has no webhook. Never put a live key (`sk_live_`, `rk_live_`, `pk_live_`) in the Worker. Leave `EMAIL_DELIVERY` as `dry_run` until a real Resend send is an intentional change. `ADMIN_EMAILS` is a comma-separated list of Google account emails (trimmed, compared without case). An empty list means nobody is an admin via Google. `ADMIN_TOKEN` remains the API fallback. The open decisions `BALL_NUMBERING`, `BALL_NUMBER_PAD`, `DEMO_AMOUNT_CENTS`, `BALL_BUNDLES`, `ALLOW_BALL_PICKING`, and `PRIZE_PODIUM`, and their `*_CONFIRMED` flags, are plain vars, not secrets. See [docs/OPERATIONS.md](docs/OPERATIONS.md).
5. A Google Cloud OAuth web client, only if admin sign-in should be on. Register both callback URLs: `http://localhost:8787/api/auth/google/callback` for local `wrangler dev`, and `https://balls.bancroft.io/api/auth/google/callback` for the demo host. Also register the JavaScript origins `http://localhost:8787` and `https://balls.bancroft.io`. Put the client id, client secret, and a long random `SESSION_SECRET` in the secrets above. If those values are missing, `/api/auth/google` answers 503 and `/admin` keeps the token field. This repository does not create the Google client or change DNS.
6. DNS for `balls.bancroft.io`, on the Cloudflare zone Brian already controls, pointing at this Worker. Done for this demo. Do not buy a domain for this demo. This repository does not register a domain or change DNS.
7. The appropriate British Columbia charitable gaming licence before any real money is taken. Until then the hosted copy stays a demonstration: test markers, no live charge, and placeholder prices and prizes until each confirmed flag is `true`. `GAMING_LICENCE_NUMBER` and `GAMING_RULES_URL` are plain vars in `wrangler.jsonc`, not secrets. Leave the licence number empty until the club has one. An empty number keeps the notice “Demo, no licence. No real tickets are sold.” on the rules page and in the footer. An empty rules URL points at the placeholder `/rules` page. Do not invent a licence number, a prize, odds, or house rules in these vars.
8. Official Kin Canada and Kinsmen Club of Ladysmith marks are in `public/marks/` for this demo. Permission to use them here is granted. They are trademarks of Kin Canada and the Kinsmen Club of Ladysmith and are not covered by the MIT license.

## Project layout

| Path | Role |
| --- | --- |
| `docs/OPERATIONS.md` | Operator handoff: Cloudflare, D1, secrets by name, Resend, Stripe test mode, offline sales, voids, CSV, and what must change before a real fundraiser |
| `wrangler.jsonc` | Worker config, assets, D1 binding, non-secret vars (including the open product decisions), secret names, cron trigger `* * * * *` |
| `src/config.ts` | Reads those vars on every request. Refuses an unknown numbering scheme, a bundle that sets its own price, a prize entry that is not a place and an amount, or a confirmed flag that is not `true` or `false` |
| `src/index.ts` | Worker entry |
| `src/app.ts` | Hono routes for the four flows and Google sign-in |
| `src/auth.ts` | Admin token fallback and Google admin check. The token compare hashes both values first |
| `src/csrf.ts` | Same-site check for admin mutations that use the Google session cookie |
| `src/google-auth.ts` | Google OAuth start, callback, and sign-out |
| `src/session.ts` | Signed session cookie |
| `src/purchase-engine.ts` | Buy, hold, confirm, offline sale, void, and the email-and-ball queries |
| `src/csv.ts` | CSV cells, with spreadsheet formulas kept as text |
| `src/exports.ts` | Admin downloads of purchases, ball selections, and email dispatches |
| `src/reservations.ts` | Five-minute reservation holds: create, release, pay, and the customer view |
| `src/hold-limits.ts` | Unpaid-hold limits: 40 per reservation, 120 per network hash |
| `src/hold-expiry.ts` | Returns expired holds to the pit. API requests and the cron both call it |
| `migrations/0007_reservation_holds.sql` | Reservation session and per-ball hold state |
| `migrations/0008_sale_voids.sql` | Void marker on a purchase, and the audit row for that void |
| `migrations/0009_hold_client.sql` | Network hash used by the unpaid-hold limit |
| `migrations/0003_email_records.sql` | Stores receipt subject and body on the email row, with the ball id |
| `src/email/deliver.ts` | Dry-run by default; Resend only when delivery is switched on and a key exists |
| `src/payments/stripe-test.ts` | Fake test-mode reference. No Stripe HTTP call |
| `src/client/app.ts` | Browser UI, compiled to `public/app.js` |
| `public/index.html` | Home marquee, pick or quantity, prizes |
| `public/pick.html` | Picker grid, find-by-number, blocks of 100 |
| `public/checkout.html` | Stripe test-mode checkout |
| `public/confirmation.html` | Test receipt |
| `public/styles.css` | Kin red / navy tokens and ball states |
| `public/fonts/` | Self-hosted Bricolage Grotesque and Source Sans 3, SIL OFL 1.1 |
| `public/purchase.html` | One purchase, opened with its receipt token |
| `public/selections.html` | Admin email-and-ball records |
| `public/admin.html` | Offline demo sales |
| `public/rules.html` | Placeholder rules page. Not the club's licence terms |
| `migrations/0001_init.sql` | D1 schema |
| `migrations/0002_seed.sql` | Sample balls, including held, sold, and one offline record |
| `migrations/0004_demo_catalogue.sql` | Earlier catalogue step, balls 49 through 1000. `0005` is what makes the catalogue 2,500 |
| `migrations/0005_catalogue_2500.sql` | Extends the demo catalogue from 1,000 balls to 2,500, then adds the receipt token |
| `migrations/0006_buyer_attestation.sql` | Stores the 19+ and in-BC attestation on a purchase |
| `.dev.vars.example` | Secret names only. Placeholders are not keys |
| `THIRD_PARTY_LICENSES.md` | Recorded dependency licenses |
| `LICENSE` | MIT |

API routes:

| Route | Flow |
| --- | --- |
| `POST /api/purchases` | Purchase engine: buy a specific ball, lock it, store the receipt |
| `POST /api/selections` | Optional hold. With a client address, the ball locks for five minutes and counts toward the unpaid-hold limit. Without one, it locks until confirm or cancel |
| `POST /api/purchases/:id/confirm-demo` | Confirm a hold without charging, then the email hook |
| `POST /api/purchases/:id/cancel` | Release a hold. The email-and-ball row stays |
| `GET /api/balls` | Ball id, number, and status for the 2,500-ball catalogue. No buyer email. Expired reservations are released first |
| `GET /api/reservations` | This browser's reservation: pending holds and the time left, plus confirmed balls. Expired and released holds are omitted |
| `POST /api/reservations` | Hold one open ball, when `ALLOW_BALL_PICKING` is `true`. Refused when buyers are assigned a ball. The five minutes start on the first hold in the reservation. At most 40 unpaid balls in that reservation, and 120 unpaid balls for one network address |
| `POST /api/reservations/release` | Release one pending hold. The shared deadline does not move |
| `POST /api/reservations/checkout` | Confirm the paid holds and release any other holds in that reservation. If one requested ball cannot be recorded, none of that checkout is kept. Paying again after success says the checkout is already paid |
| `GET /api/purchases?token=` | One purchase for that receipt token. Email is not a lookup |
| `GET /api/selections?email=` | Email-and-ball records, admin only. Same data as the route below |
| `GET /api/admin/selections?email=` | Email-and-ball records for an admin, including receipt text |
| `GET /api/auth/session` | Current Google session, if any. Does not require sign-in |
| `GET /api/auth/google` | Start Google sign-in. 503 when the client is not configured |
| `GET /api/auth/google/callback` | Google redirects here. Local: `http://localhost:8787/api/auth/google/callback`. Demo host: `https://balls.bancroft.io/api/auth/google/callback` |
| `POST /api/auth/logout` | Clear the session cookie |
| `POST /api/admin/offline-sales` | Admin offline demo sale. Google admin session, or `Authorization: Bearer` token |
| `GET /api/admin/sales` | Recent records for an admin |
| `POST /api/admin/purchases/:id/void` | Void a recorded demo sale. Body `{ "reason" }`. The purchase stays, the ball returns to the pit |
| `GET /api/admin/exports/purchases.csv` | Purchases, with payment mode, attestation, and void status |
| `GET /api/admin/exports/ball-selections.csv` | Email-and-ball rows, including void status |
| `GET /api/admin/exports/email-dispatches.csv` | Stored receipt rows |

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
- shows a demo ribbon on every page, and a second notice, “Demo, no licence. No real tickets are sold.”, on the rules page and in the footer while `GAMING_LICENCE_NUMBER` is empty
- asks a buyer, and an admin recording an offline sale, to attest that the buyer is 19 or older and physically in British Columbia, and stores that attestation with the purchase
- serves `/rules` as placeholder text until the club publishes licence terms

When `GAMING_LICENCE_NUMBER` is set, the rules page and the footer show `BC Gaming Event Licence #` plus that value. The demo ribbon stays. Setting a number in this copy does not turn on real sales. `GAMING_RULES_URL` is where the rules link points. Empty means `/rules`.

### Unverified guidance for the club to confirm

This subsection is a reading of public documents, checked on 12 November 2026. It is not a determination that this event needs a particular licence, and it is not legal advice. The club, with its own counsel, confirms what applies. The documents say they can change, and that the version on the publisher’s site prevails.

The documents are the [Licensed Charitable Gaming Event Terms and Conditions](https://www.igcobc.ca/sites/default/files/assets/documents/licensed-charitable-gaming-event-terms-and-conditions.pdf) and the [Licensed Charitable Gaming Event Guidance](https://www.igcobc.ca/sites/default/files/assets/documents/licenced_charitable_gaming_event_guidance.pdf), both marked updated 1 August 2026, plus the Independent Gambling Control Office pages [Apply for a charitable gaming event licence](https://www.igcobc.ca/charitable-gaming/apply-charitable-gaming-event-licence) and [Run a charitable gaming event](https://www.igcobc.ca/charitable-gaming/run-charitable-gaming-event). The guidance PDF’s published filename uses the spelling “licenced”.

Those documents say the previous British Columbia charitable gaming rules were replaced on 13 April 2026, and that the general manager of the Independent Gambling Control Office issues the licence. Many people still say Gaming Policy and Enforcement Branch. This repository does not decide which office a Ladysmith Kinsmen application goes to. Confirm that before applying.

Points the club should take to that office, rather than treat as decided here:

- The guidance describes an activity as gaming when someone pays something of value, a prize of value can be won, and the outcome is not predetermined or decided by skill alone. It says conducting a gaming event in BC without a licence from the general manager is unlawful. Whether Running of the Balls is that kind of event is for the club to confirm.
- A token raffle, in the guidance, links a ticket number to an object that determines the winner. Rubber duck races are one of the published examples. A ball race may fall in that category. This repository does not classify the event, and it does not build the three-part ticket the guidance describes for a token raffle.
- Licence classes A, B, and C are different, including who may hold one and what the proceeds may fund. This repository does not pick a class.
- House rules, in the terms, have to be posted where entries are sold. The listed contents include a statement that participants are 19 or older, where and when the event is, the price, how a winner is determined, prizes and how to claim them, ties and complaints, unclaimed prizes, and odds when the odds are known. `/rules` is a placeholder and does not supply any of that. Do not copy a price, a prize, or odds into this app until the club’s licence states them.
- The terms say an organization cannot advertise a gaming event until a licence is issued, and that advertising for a licensed event includes the licence number in the form “BC Gaming Event Licence #”. They also describe a responsible-gambling message, with exceptions. This demo does not invent that message or a helpline number.
- The terms’ account of the Gaming Events Regulation says a licensee must not let someone participate while they are outside British Columbia. The checkout checkbox records an attestation. It does not check a location. The club may need more than a checkbox.
- Online ordering, online payment, and an electronic raffle system are described as needing approval on the licence. This demo does not take payment. A live site that sold entries online would need whatever approval the licence actually requires. Stripe in this repository stays a fake test reference.
- The guidance says a building or capital project of $20,000 or more needs a special approval before gaming proceeds are used for it. The home page mentions an infrastructure project. That sentence is not an approved use of proceeds.
- The public “run a charitable gaming event” page says a Gaming Event Revenue and Disbursement Report is due within 90 days after the last event on the licence. This app does not prepare that report.
- The terms also describe gaming-account and two-person fund controls that depend on the projected revenue. Those are club operations, not features of this demo.

### Cloudflare Workers

The Workers runtime (`workerd`) is Apache-2.0. Using the hosted Cloudflare service is a separate matter and is governed by Cloudflare’s current service terms, including the [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) where that agreement applies. Customer code stays the customer’s content, and you still need the rights to that code and its dependencies. Review the current agreement before deploying. The hosted demo is [https://balls.bancroft.io](https://balls.bancroft.io). This repository does not deploy itself.

### Brand marks

Permission to use the official Kin Canada and Kinsmen Club of Ladysmith marks on this open-source demo is granted. The header uses `public/marks/kinsmen-club-of-ladysmith-trim.png` on white. The navy footer uses `public/marks/kin-canada-emblem.png` and credits Ladysmith Kinsmen / Kin Canada.

Those marks are trademarks of Kin Canada and the Kinsmen Club of Ladysmith. They are not licensed under the MIT license that covers the rest of this repository. Do not treat the MIT grant as permission to reuse the marks.

### Type

The pages use Bricolage Grotesque and Source Sans 3, self-hosted from `public/fonts/`, so a visit does not call Google Fonts. Both are under the SIL Open Font License 1.1, included beside the files. Source Sans 3 has the reserved name "Source". These font files are not covered by the MIT license.

### Dependency licenses

Direct dependencies must be OSI-approved and commercially usable in an open-source app on Workers. Preferred licenses are MIT, Apache-2.0, BSD, and ISC. Do not add AGPL, SSPL, Commons Clause, Business Source, non-commercial, or other terms that conflict with this MIT distribution or with running the app as a Worker. `npm run licenses` rewrites `THIRD_PARTY_LICENSES.md` and fails if a package falls outside that policy. `npm run licenses -- --check` fails on the same policy, and also when the recorded file would change, without writing it.

Buyer email in a real send would also need the club’s identification and a current postal address. The dry-run receipt names Ladysmith, British Columbia, and says no further demo messages are sent. It is a preview, not a mailing.
