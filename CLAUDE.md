# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

**Never commit directly to `main`.** Always create a feature branch, commit there, push the branch, and open a PR. This applies to every change, no matter how small.

```sh
git checkout -b <branch-name>
# make changes, commit
git push -u origin <branch-name>
gh pr create ...
```

## Commands

- `npm start` — Run the server (Express on port 3000)
- `npm run db:setup` — Initialize DB: load schema, test data, and exchange rates
- `npm run db:reset` — Drop and recreate schema only
- `npm run create-user` — Create a new user (interactive CLI)
- `npm run db:add-snapshot` — Add a manual balance snapshot (interactive CLI)
- `npm run db:import-csv` — Import balance data from CSV
- `npm run db:refresh-rate` — Update USD/CAD exchange rate
- `npm run db:seed` — Load sample data (demo user + fictional accounts)
- `docker compose up` — Run locally with Docker (app + Postgres + Caddy SSL)
- `docker compose down -v` — Tear down local Docker environment
- `bash scripts/setup-local-ssl.sh` — One-time: trust Caddy's local CA in macOS Keychain
- `./db_backup.sh backup_localhost` — Backup local database to `backups/` (uses `.env.local`)
- `./db_backup.sh backup_prd` — Backup production database to `backups/` (uses `.env.production`)
- `./db_backup.sh prd_to_localhost` — Snapshot local DB, then pull and restore production data locally

No test framework is configured. No linter or formatter is configured.

## Architecture

Monolithic Node.js (Express 5) app with vanilla JS frontend. Single `server.js` file contains all backend logic (~1150 lines). Frontend is static files served from `public/`.

**Backend (`server.js`)**
- All API routes defined inline (no router modules)
- PostgreSQL via `pg` pool — always uses `DATABASE_URL`; in Docker this is overridden by `docker-compose.yml`
- Plaid API integration for fetching bank balances
- Session auth with `express-session` + `connect-pg-simple` store (25-min rolling idle timeout)
- Plaid access tokens encrypted in DB using pgcrypto with `DB_ENCRYPTION_KEY`

**Frontend (`public/`)**
- `index.html` + `js/dashboard.js` — Main dashboard with Chart.js trend charts, balance cards, account detail sidebar
- `login.html` + `js/login.js` — Login form
- `connect.html` + `js/connect.js` — Plaid Link bank connection flow

**Database (`db/schema.sql`)**
- Core tables: `users`, `plaid_items`, `accounts`, `balance_snapshots`, `exchange_rates`, `session`
- `balance_snapshots` has UNIQUE constraint on `(account_id, date)` — one balance per account per day
- Liabilities/credit cards stored as negative balances
- `accounts.is_active` used for soft-delete
- `accounts.plaid_account_id` is NULL for manual (non-Plaid) accounts

**Key business logic:**
- `/api/trend_data` uses SQL WITH clauses to generate a complete daily date series with carry-forward for missing balances, then aggregates by granularity (daily/weekly/monthly)
- `/api/refresh_balances` fetches from Plaid, handles liability sign inversion, caches exchange rates per refresh cycle, and upserts via `ON CONFLICT (account_id, date)`
- USD balances are converted to CAD using `exchange_rates` table (auto-refreshed every 24 hours from exchangerate-api.com)

## Environment

Requires `.env` with: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `DATABASE_URL`, `DB_ENCRYPTION_KEY`, `SESSION_SECRET`, `ALLOWED_ORIGIN`, `NODE_ENV`

**Local dev:** PostgreSQL database named `balance_tracker` on localhost. Server runs on port 3000. Docker setup includes Caddy reverse proxy for local HTTPS (`https://localhost`).

**Production:** Deployed on Render.com (`render.yaml`). Supabase PostgreSQL. HTTPS enforced.


## Milestones

**Milestone 0:** COMPLETED: A solid dashboard strategy, integration with Plaid, plus a manual account update strategy has been established. App and visualizations work appropriately locally as well as deployed remotely to Render.

**Milestone 1:** COMPLETED: Establish a more agnostic and resilient deployment pattern. There is desire to easily deploy locally with Docker, and also to any IaaS/PaaS solution (Render, AWS, Azure). Any remote solution could vary over time.

**Milestone 2:** COMPLETED: Database backup and restore is handled by `db_backup.sh`. Supports backing up localhost or production, and restoring production to localhost (with automatic pre-restore local snapshot). Credentials sourced from env files. Backups auto-pruned after 30 days. Sample data loadable via `npm run db:seed`. RLS enabled on Supabase via `db/enable_rls.sql`.

**Milestone 3:** Deploy to AWS. I don't want to click to set up things in AWS except for in my sandbox where I might want to experiement. For all other environments I want to use Terraform to manage the deployments to AWS. I want to have at least one pre-production environment for my application and also one or more pre-production environments for my IaC.

## Backlog

**Pending promotion to production:**
- Run `node migrations/010_add_account_category.js` against the production DB before or immediately after deploying the retirement feature. The migration is idempotent and safe to re-run.

**Manual retirement account form:**
- No UI exists yet for adding a manual (non-Plaid) retirement account. Currently requires using `npm run db:add-snapshot` directly. A form on `connect.html` or a dedicated page should include: account name, institution, account type (401k/IRA/RRSP/etc.), currency (CAD/USD), and category toggle (Liquid/Retirement).

**Tests:**
- No test framework is configured. First priorities when adding tests:
  - Unit tests for retirement subtype auto-classification logic (server.js `RETIREMENT_SUBTYPES` set)
  - Unit tests for the trend data carry-forward SQL CTE (or an integration test against a test DB)
  - Auth middleware / session expiry behaviour
