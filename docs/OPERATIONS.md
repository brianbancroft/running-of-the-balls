# Operations

Handoff for the person who runs this demonstration, or who prepares a later fundraiser. It is not legal advice. The compliance notes in the [README](../README.md) are the constraint. A push to this repository does not deploy the Worker, apply remote migrations, change DNS, or spend money.

The hosted demonstration is [https://balls.bancroft.io](https://balls.bancroft.io). It is not a licensed gaming site and it does not take payment.

## What is already decided

- The catalogue is 2,500 balls. That count is the rows in `balls`. It is not a var.
- One checkout may buy as many open balls as remain. There is no multi-ball cap. Unpaid holds are limited (40 in one reservation, 120 for one network address).
- The beneficiary line is a fundraiser for the Kinsmen Club of Ladysmith for an upcoming infrastructure project. That sentence is not an approval to spend gaming proceeds.

## Open product decisions

These are still unconfirmed. They live in one place: the plain vars in `wrangler.jsonc`, read by `src/config.ts`. The safe demo defaults are below. The pages and the stored receipt say the figures are pending a decision. Setting a var does not turn that label off, and it does not make the value a licence term.

| Var | Demo default | What it does |
| --- | --- | --- |
| `BALL_NUMBERING` | `sequential_from_1` | The only scheme this demo implements. Stored numbers are the integers 1 through 2500 already in D1. Any other value refuses to start. This var does not renumber the database. |
| `BALL_NUMBER_PAD` | `3` | Zero-padding on the public label. Ball 7 is shown as `007` on the page and in the receipt subject. `0` shows `7`. A longer number is not cut, so 2500 stays 2500. CSV files keep the integer. |
| `DEMO_AMOUNT_CENTS` | `500` | Placeholder price for one ball, in Canadian cents. `500` is $5.00. It is not a ticket price. |
| `BALL_BUNDLES` | `[]` | No bundles. A later entry is `{"quantity":5,"label":"Five balls"}` and costs that many times `DEMO_AMOUNT_CENTS`. A bundle cannot carry its own price. An invented price in the JSON refuses to start. |
| `ALLOW_BALL_PICKING` | `true` | When a buyer may choose a ball. `true` lets them pick any open ball for the whole demo. `false` assigns an open ball at checkout and refuses a chosen number, including `POST /api/reservations`. There is no sale window or phase. |

Prizes on the home page are labelled as placeholders. They are not these vars, and they are not this year's prize list.

Change a plain var in `wrangler.jsonc` for local `wrangler dev`. A hosted Worker only sees the change when someone deploys. This repository does not deploy.

## Fresh Cloudflare account

1. Create a Cloudflare account and read the current service terms, including the [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) where it applies.
2. Install dependencies and log in. Do not put the login token in git.

   ```bash
   npm ci
   npx wrangler login
   ```

3. Create a D1 database. Wrangler prints a `database_id`. Put that id on the `d1_databases` entry named `running-of-the-balls` in `wrangler.jsonc`. The id already in the file is the hosted demo. Replace it only for a new database. Do not delete the hosted database from this repository.

   ```bash
   npx wrangler d1 create running-of-the-balls
   ```

4. Apply every file in `migrations/`, in order. Local and remote are separate. A push does not apply either.

   ```bash
   npm run d1:migrate:local
   npx wrangler d1 migrations apply running-of-the-balls --remote
   ```

   The hosted demo already has migrations through `0006`. `0007` (reservation holds), `0008` (voids), and `0009` (the unpaid-hold network hash) have to be applied on that database before a Worker that uses those tables is deployed. Until `0007` is applied, selecting a ball fails. Until `0008` is applied, voiding a sale fails. Until `0009` is applied, holding a ball fails.

5. Set secrets by name. Values stay out of git. `npx wrangler secret put <NAME>` publishes a Worker version, so treat it as a deploy. Names only:

   | Name | What it is |
   | --- | --- |
   | `RESEND_API_KEY` | Resend API key. Unused while `EMAIL_DELIVERY` is `dry_run`. |
   | `STRIPE_SECRET_KEY` | Empty, or a Stripe test secret (`sk_test_` or `rk_test_`). The Worker does not send it anywhere. |
   | `ADMIN_TOKEN` | Bearer token for the admin API. Not stored on a void; the audit row says `admin-token`. |
   | `ADMIN_EMAILS` | Comma-separated Google account emails that may use `/admin`. Trimmed, compared without case. Empty means no Google admin. |
   | `GOOGLE_CLIENT_ID` | Google OAuth web client id, only if admin sign-in is on. |
   | `GOOGLE_CLIENT_SECRET` | That client's secret. |
   | `SESSION_SECRET` | Long random string that signs the admin session cookie. |

   `.dev.vars.example` lists the same names for local `wrangler dev`. Copy it to `.dev.vars`. That file is gitignored.

6. Leave the plain vars `DEMO_MODE=true`, `PAYMENT_MODE=stripe_test_fake`, and `EMAIL_DELIVERY=dry_run`. The Worker refuses to start if demo mode or the payment mode is anything else. `EMAIL_FROM` must look like `Name <email@domain>`. The demo value `onboarding@resend.dev` is Resend's shared test sender, not the club's address.

7. Deploying installs the cron trigger `* * * * *`, which returns expired holds to the pit once a minute. API requests sweep as well. The command is `npx wrangler deploy`. This repository does not run it. Do not buy a domain and do not change DNS for the demo. `balls.bancroft.io` already points at the hosted Worker.

8. Local check, with no Cloudflare account:

   ```bash
   npm run d1:migrate:local
   npm run dev
   ```

   Open `http://localhost:8787`. `npm run check` typechecks, audits dependency licenses, and runs the tests.

## Resend

Receipts are stored in `email_dispatches` either way. Nothing is sent while `EMAIL_DELIVERY` is `dry_run`, or while `RESEND_API_KEY` is empty.

To send for real, later, and on purpose:

1. Add the club's domain in the Resend dashboard and add the DNS records Resend shows for that domain. Wait until Resend marks the domain verified. This repository does not create those records.
2. Set `EMAIL_FROM` to an address on that verified domain.
3. Set `RESEND_API_KEY` with `wrangler secret put`.
4. Change `EMAIL_DELIVERY` from `dry_run` to `resend` and deploy.

`onboarding@resend.dev` can only deliver to Resend's own test inbox. It is not a from-address for buyers.

## Stripe

The Worker never calls Stripe. There is no webhook route, and there is nothing to register in the Stripe dashboard. `STRIPE_SECRET_KEY` may be empty or a test secret. A live key (`sk_live_`, `rk_live_`, or `pk_live_`) makes purchases fail. An unrecognized key does too. The value is not sent to Stripe. The purchase row stores a local `cs_test_fake_…` reference.

`STRIPE_PUBLISHABLE_KEY` in `.dev.vars.example` is not read. Leave it as a placeholder or omit it. Do not put a live publishable key anywhere in this project.

`PAYMENT_MODE` stays `stripe_test_fake`. There is no live charge path to switch on.

## Admin sign-in

Buyers do not sign in. `/admin` and `/selections` do.

- Google, when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` are set, and the account's email is in `ADMIN_EMAILS`. Callback URLs, when that client is created: `http://localhost:8787/api/auth/google/callback` and `https://balls.bancroft.io/api/auth/google/callback`. JavaScript origins: `http://localhost:8787` and `https://balls.bancroft.io`.
- Otherwise, `Authorization: Bearer` matching `ADMIN_TOKEN`. The admin page has a token field. A state-changing request that uses the Google session cookie must come from this site. A bearer token does not send `Origin`.

If the Google values are missing, `/api/auth/google` answers 503 and the token field stays.

## Record an offline sale

1. Open `/admin` and sign in.
2. Type the ball's number. Leading zeros are optional: `7` and `007` are the same ball while the pad is 3. The field is the stored integer, not a different id.
3. Enter the buyer's email and, if you have it, their name. The note can stay empty. An empty note is stored as "Recorded at the club table in the demo."
4. Check the box that the buyer confirmed they are 19 or older and physically in British Columbia. The sale is refused without it. The row stores `attested_by` `admin`.
5. Submit. The ball locks the same way as an online purchase. `payment_mode` is `offline_demo`. Nothing is charged. A receipt row is stored and, while delivery is `dry_run`, not sent.

A ball another buyer still holds (`pending_payment`, inside the five minutes) is refused. After those five minutes the sweep frees it, and the same ball can be recorded. An online purchase and an offline sale of the same ball cannot both succeed.

## Void a sale

On the same page, under "Void a mistaken sale":

1. Copy the purchase id from the recent-sales list, or paste one you already have. "Use this id" fills the field.
2. Enter a reason. It is required, and it is capped at 500 characters.
3. Submit.

The purchase stays in the customer receipt and in `/selections`, marked voided. It is not deleted. The ball goes back in the pit. An audit row stores who, when, why, which ball, and the original purchase. A token admin is recorded as `admin-token`. A Google admin is recorded as that account's email. A second void of the same sale is refused. A hold that was never paid is not a sale, and this action does not void it. The ball can be held or sold again.

## Export CSV

The same sign-in downloads three files:

| File | Contents |
| --- | --- |
| `purchases.csv` | Payment mode, the 19+ and in-BC attestation, void status, ball id and number. |
| `ball-selections.csv` | Email, ball, purchase, and void status. |
| `email-dispatches.csv` | Stored receipt subject and body. |

Receipt tokens are left out. A receipt link inside a stored email is written as `token=redacted`. A cell that a spreadsheet would treat as a formula is prefixed so it stays text. The admin page can still show the full receipt, including the link, to a signed-in admin.

## Before any real fundraiser

Do all of this before anyone pays. Doing part of it does not make the demo a sale.

1. The club holds the British Columbia charitable gaming licence that actually applies, confirmed with its own counsel. Put that number in `GAMING_LICENCE_NUMBER`. Leave it empty until then. An empty number keeps the banner "Demo — not licensed, no real tickets sold." Do not invent a number. The demo ribbon stays even after a number is set. Setting a number does not enable real sales.
2. Publish the real rules and point `GAMING_RULES_URL` at them, or replace `/rules`. Empty means the placeholder `/rules` page. House rules have to be posted where entries are sold. `/rules` does not state a price, a prize, odds, how a winner is chosen, or what happens to an unclaimed prize. Do not copy those in until the licence states them.
3. The owner decides the numbering scheme, the ticket price, any bundles, and when a buyer may pick a ball instead of being assigned one. Set the vars in the table above to those decisions. The pages keep the "pending a decision" label until a later code change removes it, so a filled-in default is not mistaken for a licence term.
4. Leave Stripe in test/fake mode. There is no live payment integration. `DEMO_MODE` must stay `true`. The database forces `demo_only`. Turning on real card charges would be a new design, not a setting in this demo.
5. If email will actually be sent, use the club's verified domain and put the club's identification and a current postal address in the receipt. The dry-run text names Ladysmith, British Columbia, and says no further demo messages are sent. It is a preview, not a mailing.
6. Do not advertise the event before a licence is issued. Advertising for a licensed event uses the licence number in the form the terms require. This demo does not invent that line beyond the banner that appears when `GAMING_LICENCE_NUMBER` is set.
7. A building or capital project at the size described in the public guidance can need its own approval before gaming proceeds are used. The infrastructure sentence on the home page is not that approval.
8. The Kin Canada and Kinsmen Club of Ladysmith marks in `public/marks/` are used here with permission for this demo. They are not covered by the MIT license.
