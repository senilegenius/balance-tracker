# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

No test framework is configured. No linter or formatter is configured.

## Architecture

Monolithic Node.js (Express 5) app with vanilla JS frontend. Single `server.js` file contains all backend logic (~1150 lines). Frontend is static files served from `public/`.

**Backend (`server.js`)**
- All API routes defined inline (no router modules)
- PostgreSQL via `pg` pool — connection string from `DATABASE_URL` (production) or `DATABASE_URL_LOCAL` (development)
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

Requires `.env` with: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `DATABASE_URL`, `DATABASE_URL_LOCAL`, `DB_ENCRYPTION_KEY`, `SESSION_SECRET`, `ALLOWED_ORIGIN`, `NODE_ENV`

**Local dev:** PostgreSQL database named `balance_tracker` on localhost. Server runs on port 3000. Docker setup includes Caddy reverse proxy for local HTTPS (`https://localhost`).

**Production:** Deployed on Render.com (`render.yaml`). Supabase PostgreSQL. HTTPS enforced.


## Milestones

**Milestone 0:** A solid dashboard strategy, integration with Plaid, plus a manual account update strategy has been established. App and visualizations work appropriately locally as well as deployed remotely to Render.

**Milestone 1:** Establish a more agnostic and resilient deployment pattern. There is desire to easily deploy locally with Docker, and also to any IaaS/PaaS solution (Render, AWS, Azure). Any remote solution could vary over time.

