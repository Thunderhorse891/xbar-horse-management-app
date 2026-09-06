# XBAR Command Infrastructure

Premium operational command infrastructure for modern horse and ranch operations: command files, proof control, title and transfer posture, care status, buyer movement, operating ledger, field conditions, and ranch control across web and mobile.

## Runtime

- Web: Vite + React, deployed through Vercel
- Mobile: Capacitor wrapping the same React application for iOS and Android
- Persistence: local-first IndexedDB with optional Supabase auth, storage, and workspace sync
- Billing: Stripe Billing and Checkout Sessions when server environment variables are configured

## Getting Started

```sh
git clone https://github.com/Thunderhorse891/XBAR.git
cd XBAR
npm install
npm run dev
```

## Core Scripts

| Script                     | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Start the web app locally                                      |
| `npm run build`            | Typecheck, build the app bundle, then generate the public site |
| `npm run preview`          | Serve `dist` with production-parity routing (`serve-dist`)     |
| `npm run test`             | Prepare the Supabase schema, typecheck, and run unit tests     |
| `npm run test:e2e`         | Run Playwright end-to-end tests                                |
| `npm run test:prod-smoke`  | Build `dist` and smoke-test the production bundle in a browser |
| `npm run lint`             | Run ESLint across the repo                                     |
| `npm run format:check`     | Verify Prettier formatting (CI-gated)                          |
| `npm run supabase:prepare` | Generate the executable, idempotent production Supabase schema |
| `npm run mobile:sync`      | Build and sync the app into Capacitor targets                  |

## Deployment

### Web — public site and application are separate surfaces

- **`/` is the public marketing site**: complete static HTML generated at
  build time by `scripts/build-marketing.mjs` (home, features, pricing,
  solutions, resources, demo, privacy, terms). Every page ships unique
  server-generated metadata, a self-referencing canonical, and JSON-LD, and
  never loads the application bundle.
- **`/app/*` is the authenticated application**: the SPA shell is emitted as
  `dist/app.html`, rewritten under `/app/*` by `vercel.json`, and marked
  `noindex` (meta tag + `X-Robots-Tag`). The React Router basename is `/app`
  (`src/lib/routeCanon.ts`).
- `vercel.json` also 308-redirects legacy paths (`/login`, `/landing`,
  `/horses`, `/profiles/:id`, …) into their new homes and redirects
  `www.xbar.app` to the canonical `xbar.app` host.
- `sitemap.xml` is generated with the marketing pages only; `robots.txt`
  disallows `/app`, `/api/`, `/profiles/`.
- `scripts/serve-dist.mjs` mirrors this routing locally (`npm run preview`)
  and backs the prod-smoke Playwright suite.
- Hash routing remains available for GitHub Pages previews and is forced for
  mobile builds (`scripts/build-mobile.mjs`), which skip marketing generation.

### Mobile

1. Add a native target with `npm run mobile:add:ios` or `npm run mobile:add:android`.
2. Sync the current build with `npm run mobile:sync`.
3. Open it with `npm run mobile:open:ios` or `npm run mobile:open:android`.

Capacitor configuration lives in `capacitor.config.ts`.

## Design System

- Premium command infrastructure, not generic SaaS dashboard UI
- Graphite shell, metallic/silver workspace surfaces, restrained electric-blue control accents
- Shared brand rule: one system, distinct operational silhouettes per section
- Typography: exactly one UI family (Outfit) and one display family (Fraunces),
  declared as `--font-ui` / `--font-display` in `src/index.css` and loaded once
  from `index.html` — no per-file font imports
- Command-center visual layer in `src/routes/xbarCommandSystem.css` and `src/routes/commandCenterLocal.css`
- Interaction affordances in `src/routes/interactionSystem.css`
- Base tokens and foundational styles in `src/index.css`
- Public marketing site styles live in `scripts/marketing/site.css` (single
  stylesheet, no application CSS)
- Dead CSS is not tolerated: rules whose classes are unreachable from the
  source tree get removed (see the measured prune in
  `docs/PRODUCTION-AUDIT-2026-07.md`)

### Workflow integrity rule

No button may report success without persistent evidence. Every create/update
action in the UI calls a real store mutation and reports the store's actual
result; navigation actions are labeled as navigation ("Open …"), not as
creation. `tests/marketingSite.test.ts` additionally blocks unverifiable
social-proof claims from the public site.

## Product Standard

Each product surface should answer the same operational sequence:

1. Entity
2. Status
3. Evidence
4. Risk
5. Next action

Daily operations should not collapse into repeated dashboards. Command Center, Command Files, Title & Transfer, Proof Vault, Care Status, Buyer Desk, Operating Ledger, Ranch Assets, Field Conditions, and Ranch Control each require a distinct layout silhouette and workflow.

## Production Environment

Copy `.env.example` to `.env.local` for local development. Configure the same variable names in Vercel Preview and Production. Never expose server secrets with a `VITE_` prefix.

Required for browser cloud auth and sync:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional, and empty by default:

- `VITE_AUTH_OAUTH_PROVIDERS` — comma-separated list of `google`, `facebook`,
  `apple`. Controls which third-party sign-in buttons the login screen draws.
  Leave it unset until a provider is enabled in **Supabase → Authentication →
  Providers** _and_ its OAuth client is registered with the provider itself.
  Supabase answers a redirect for anything else with HTTP 400 `Unsupported
provider: provider is not enabled`, which a customer experiences as a button
  that does nothing. Native store builds never show these buttons, because a
  web OAuth redirect cannot complete inside the app WebView.

Required for managed Stripe billing and webhook reconciliation:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_STARTER`
- `STRIPE_PRICE_ID_PROFESSIONAL`
- `STRIPE_PRICE_ID_RANCH_OPS`
- `STRIPE_PRICE_ID_ENTERPRISE`
- `PUBLIC_APP_URL`

Owner/QA access (all optional, all off by default):

- `XBAR_COMP_EMAILS` (server) — the allowlist that grants full entitlements for
  API-checked cloud actions. It is keyed on email rather than workspace, always
  grants Enterprise rather than a chosen tier, and is applied by the API only —
  the database limit triggers read `workspace_subscription_profiles` and never
  see it. So it is a preview and QA tool, **not** a way to comp a paying
  customer: the API would report Enterprise while seat, storage and commercial
  writes were still refused at the stored tier.
- `VITE_XBAR_COMP_EMAILS` (client) — the matching list so the UI shows what the
  server will honour. Set both to the same value; setting only the client one
  shows tiers the server refuses.
- `VITE_XBAR_LOCAL_OWNER_MODE` (client) — local tier preview for a machine with
  no cloud account. **Not available in production**: it is compiled in at build
  time and a production bundle refuses it even when the variable is set, so it
  cannot be switched on from a URL, from localStorage, or from anything a
  visitor can edit. It previews the UI only — cloud actions are still authorized
  against the real account.

Tier preview never writes to a workspace's real subscription, so returning to
the real plan is switching the overlay off rather than repairing data.

Optional browser configuration is documented in `.env.example`, which states for
every variable whether it is client-safe or server-only, whether it is needed
now or later, and what the app does when it is absent.

### Running without Supabase or Stripe

Neither is required. With both absent the app runs locally: records stay in the
browser, and the billing screen shows every tier, price, limit and feature list
while saying **Billing not configured yet**. No checkout opens, no subscription
record is created, and no identifier is invented — missing configuration is
reported, never faked.

### Pending Supabase migrations (not applied)

Five migrations in `supabase/migrations/` are written and reviewed but have
**not** been run against any project. The order matters, and it is carried by
the version prefixes rather than by convention — Supabase takes the digits
before the first underscore as the migration version, so each file needs its
own:

1. `20260820_entitlement_helpers_honor_inactive.sql` — schema. Makes the
   database's limit helpers agree with the API about which billing states keep
   a purchased tier. Safe to re-run: both functions are `create or replace`
   with unchanged signatures, and no trigger is detached.
2. `20260821_reconcile_legacy_manual_billing.sql` — **data**. Reconciles rows
   the previous status mapper stored as `Manual Billing` when the subscription
   had actually canceled, paused, or never completed its first payment. Without
   this, step 1 changes nothing for those workspaces, because `Manual Billing`
   is correctly still an entitled state.
3. `20260822_restrict_anon_rpc_surface.sql` — grants. Closes the unauthenticated
   RPC surface left by PostgreSQL's default `EXECUTE` grant to `PUBLIC`.
4. `20260826_checkout_session_lock.sql` — schema. Adds the column that
   serializes Checkout Session creation per workspace, so two concurrent
   requests cannot each create a billable subscription session. Additive and
   independent of the other three: one nullable column and one partial index,
   no rewrite, and its order in the sequence does not matter.
5. `20260827_subscription_event_ordering.sql` — schema. Adds
   `stripe_event_created_at` and the `xbar_apply_subscription_event` function
   that applies a billing event atomically, so a retried event Stripe created
   earlier cannot overwrite a newer one. Events sharing a `created` second are
   admitted — a plan change emits several — except that a tied entitlement
   adopted from a SIBLING subscription loses, which is what stops one of two
   simultaneously canceled subscriptions writing back a stale `Active`
   snapshot of the other. Only that write is speculative: the sibling list is
   read before the lock. An event about its own subscription still wins a tie,
   so a re-subscription completed in the same second as a cancellation is not
   thrown away. Additive: one nullable column, one index, one
   function, no backfill.

Apply them **one at a time**, not with a single `supabase db push`. That command
applies every pending migration in one go, which would run the data
reconciliation before anyone had read its dry-run.

```
# 1. schema only — safe to apply directly
psql "$DATABASE_URL" -f supabase/migrations/20260820_entitlement_helpers_honor_inactive.sql

# 2a. READ FIRST: the dry-run at the top of the file lists every candidate row
#     and its disposition. Run that query and read every row.
# 2b. The migration is inert on its own — applying it without the setting below
#     changes nothing and prints "reconciliation SKIPPED". Re-run it with:
#     Omit either list entirely if it is empty; a literal '<uuid>,<uuid>'
#     aborts the migration rather than being ignored.
psql "$DATABASE_URL" \
  -c "set xbar.reconcile_confirmed = 'yes'" \
  -c "set xbar.reconcile_exclude = '<uuid>,<uuid>'" \
  -c "set xbar.reconcile_terminal = '<uuid>,<uuid>'" \
  -f supabase/migrations/20260821_reconcile_legacy_manual_billing.sql
# 2c. Confirm the outcome. The AFTER APPLYING block at the bottom of that file
#     lists every remaining Manual Billing row with its disposition. It reads
#     xbar.reconcile_exclude, so restate the same list if you run it in a new
#     session, and expect the rows you excluded to come back Stripe-backed and
#     still Manual Billing — that is what excluding them did.
# 2d. Clear all three so they cannot colour later work in the same session:
psql "$DATABASE_URL" \
  -c "reset xbar.reconcile_confirmed" \
  -c "reset xbar.reconcile_exclude" \
  -c "reset xbar.reconcile_terminal"

# 3a. grants — STAGING FIRST. This one revokes; a missing grant is a broken
#     read for every signed-in user, so it is proved somewhere disposable.
psql "$STAGING_DATABASE_URL" -f supabase/migrations/20260822_restrict_anon_rpc_surface.sql
node scripts/verify-rpc-surface.mjs "$STAGING_DATABASE_URL"
# 3b. Then exercise staging by hand — steps 3 and 4 of the HOW TO APPLY block
#     inside that migration. The verifier proves the anon surface shrank; only
#     loading a workspace and running a document upload proves nothing that
#     should still work broke.
# 3c. ONLY THEN production, ideally in a low-traffic window. Skipping this line
#     leaves production on the default unauthenticated EXECUTE grants — every
#     SECURITY DEFINER function, the unmaintained legacy listing resolver
#     included — which is the whole of what this migration exists to close.
psql "$DATABASE_URL" -f supabase/migrations/20260822_restrict_anon_rpc_surface.sql
node scripts/verify-rpc-surface.mjs "$DATABASE_URL"

# 4. checkout lock — additive, safe to apply directly, order does not matter
psql "$DATABASE_URL" -f supabase/migrations/20260826_checkout_session_lock.sql

# 5. billing event ordering — additive, safe to apply directly
psql "$DATABASE_URL" -f supabase/migrations/20260827_subscription_event_ordering.sql
```

**(4) and (5) are prerequisites for billing, not optimizations to schedule
later.** Apply both before Stripe is switched on, and note that they fail in
opposite directions:

Until (4) is applied, `api/stripe/checkout.js` cannot claim its lock and
**refuses every checkout** as retryable. That is deliberate — the alternative
is creating billable sessions without serialization — and it fails visibly, on
the way in.

Until (5) is applied, `api/stripe/webhook.js` cannot call
`xbar_apply_subscription_event` and **every entitlement webhook fails**. That
one fails on the way OUT, which is the dangerous order: a customer can complete
and pay for a Checkout Session and never have the plan activated, because the
event that would have granted it errors and Stripe eventually stops retrying.
Applying (5) without (4) is therefore the worse half-deployment of the two —
prefer both, and if you must stage them, apply (5) first.

`xbar.reconcile_exclude` is how you keep a row the migration would otherwise
downgrade. A populated `stripe_subscription_id` proves the workspace was billed
through Stripe at some point; it does **not** prove the current `Manual Billing`
value came from the old mapper. If you deliberately moved a paying customer to
manual invoicing, or comped them after they had been paying, that row looks
identical from inside the database — list its workspace id here and it is left
alone.

`xbar.reconcile_terminal` is the other half of that decision. A reconciled row
is written `subscriptionRecoverable: true` by default, which withholds checkout
so a paused or unpaid subscription cannot be bought a second time. A **canceled**
subscription will never send another webhook to correct that flag, so a
customer who wants to come back would stay blocked. List the workspaces you have
confirmed in the Stripe dashboard are canceled or expired, and they are written
`false` and can purchase immediately. The migration's RECOVERABILITY section
carries a query over `workspace_subscription_events` to shortlist them.

Use plain `set`, not `set local`: these are issued before the migration's own
`begin`, and `set local` outside a transaction block applies nothing — the
migration would read an empty setting and report `reconciliation SKIPPED` while
you believed you had confirmed it. Being session-scoped, they outlive the
migration — step 2d above clears all three when you are finished.

After applying, re-run the security advisor and confirm
`anon_security_definer_function_executable` has dropped to the intended set;
the counts are documented at the bottom of file 3.

### Operations

- **Health probe**: `GET /api/health` returns liveness plus subsystem-configured booleans (no secrets, no database touch). Point uptime monitors here.
- **Rate limiting**: every request-driven API endpoint is per-IP rate limited. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so limits are shared across all serverless instances; without them the limiter degrades to per-instance in-memory counting.
- **Crash telemetry**: uncaught browser errors and unhandled promise rejections are reported to `runtime_events` through `/api/telemetry` (rate limited, workspace-verified, capped at 20 reports per session).
- **Marketing analytics**: every public page loads the first-party beacon `/site.js`, which reports pageviews and CTA clicks to `/api/metrics` — anonymous (no cookies, no identifiers, honors Do Not Track), CSP-safe, logged in the Vercel function stream, and stored in `runtime_events` as `marketing.*` when Supabase is configured.
- **Go-live preflight**: `npm run preflight` reports which subsystems are configured and what each missing env var keeps switched off; add `-- --url <deployment>` to probe the live `/api/health` and compare.
- **Webhook replays**: Stripe webhook deliveries are idempotent on `stripe_event_id` — retried events are acknowledged without re-running the subscription sync.
- **CI**: every push runs lint, format check, production-dependency audit, typecheck, unit tests, build, and a browser smoke test of the built bundle; CodeQL scans weekly and on PRs; Dependabot files grouped weekly updates.

### Supabase Bootstrap

Do not paste `supabase/production-schema.sql` directly into production. Generate the executable schema first:

```sh
npm run supabase:prepare
```

Then apply `supabase/production-schema.generated.sql` in the Supabase SQL editor. It converts unsupported policy syntax and appends the idempotent workspace RLS hardening migration.

### Stripe Go-Live

1. Create recurring Stripe prices for Starter `$29`, Professional `$79`, Ranch Ops `$199`, and Enterprise `$499`.
2. Set each corresponding `STRIPE_PRICE_ID_*` variable in Vercel Preview and Production.
3. Configure `/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
4. Set `STRIPE_WEBHOOK_SECRET` and verify a test-mode checkout before enabling live mode.

Managed checkout is restricted to workspace admins and only returns customers to trusted XBAR origins.

## Product State

- Local-first workspace with backup import and export
- Optional cloud authentication, relational workspace sync, and document storage through Supabase
- Managed Stripe checkout and webhook-driven subscription reconciliation
- Command files for horse identity, care, ownership, documents, sales, and operating history
- Title & Transfer desk for chain-of-title posture, release evidence, stakeholder share, and proof gaps
- Proof Vault for document intake, review, matching, approval, and buyer-safe release
- Operating Ledger for receipt intake, cost allocation, and ranch-level expense visibility
- Buyer Desk, buyer follow-ups, shared buyer packets, ranch assets, action queue, and field conditions
