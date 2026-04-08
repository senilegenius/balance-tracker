# Balance Tracker

A personal finance dashboard that aggregates bank account balances using the Plaid API and displays trends over time. All balances are converted to CAD for a unified view of liquid cash minus credit card debt.

## Features

- **Plaid Integration** — Automatically fetch balances from connected bank accounts
- **Manual Accounts** — Track accounts not supported by Plaid
- **Trend Charts** — Daily, weekly, and monthly views of liquid cash over time with linear trend lines
- **Multi-Currency** — USD balances auto-converted to CAD using live exchange rates
- **Account Detail** — Per-account history with monthly aggregation and 3-month stats
- **Session Auth** — Username/password login with rolling idle timeout

## Tech Stack

- **Backend:** Node.js, Express 5, PostgreSQL (`pg`)
- **Frontend:** Vanilla JS, Chart.js
- **APIs:** Plaid (bank data), exchangerate-api.com (FX rates)
- **Auth:** `express-session` + `connect-pg-simple`, `bcrypt`
- **Security:** Helmet, rate limiting, CORS, pgcrypto for token encryption

## Prerequisites

- Plaid developer account (for bank connections)
- **npm/Node workflow:** Node.js >= 24, PostgreSQL
- **Docker workflow:** Docker Desktop

## Local Development

Clone the repo:

```bash
git clone <repo-url>
cd balance-tracker
```

Choose your workflow:

---

### Option A: npm/Node

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file from the template:

   ```bash
   cp .env.example .env
   ```

   Fill in your Plaid credentials, `DB_ENCRYPTION_KEY`, and `SESSION_SECRET`. Keep `DATABASE_URL=postgresql://localhost/balance_tracker` and `ALLOWED_ORIGIN=http://localhost:3000`.

3. Set up the database:

   ```bash
   createdb balance_tracker
   npm run db:setup
   ```

4. Create a user:

   ```bash
   npm run create-user
   ```

5. Start the server:

   ```bash
   npm start
   ```

   Visit `http://localhost:3000`.

---

### Option B: Docker

Docker Compose runs the app, PostgreSQL, and a Caddy reverse proxy for local HTTPS. The database is initialized automatically with the schema and sample data on first start.

1. Create a `.env.local` file from the template:

   ```bash
   cp .env.example .env.local
   ```

   Fill in your Plaid credentials, `DB_ENCRYPTION_KEY`, and `SESSION_SECRET`. Set:
   - `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/balance_tracker`
   - `ALLOWED_ORIGIN=https://localhost`

2. Start all services:

   ```bash
   docker compose up -d
   ```

3. Trust Caddy's local CA (macOS only — required after every `docker compose down -v`):

   ```bash
   bash scripts/setup-local-ssl.sh
   ```

4. Create a user:

   ```bash
   docker compose exec app npm run create-user
   ```

5. Visit `https://localhost`. Log in with the user you just created, or use `demo` / `demo1234` (pre-loaded with sample data).

6. To tear down and start fresh:

   ```bash
   docker compose down -v && docker compose up -d
   bash scripts/setup-local-ssl.sh
   ```

## Scripts

For Docker, prefix npm commands with `docker compose exec app` (e.g. `docker compose exec app npm run create-user`).

| Command | Description |
|---|---|
| `npm start` | Start the server (npm/Node only) |
| `npm run db:setup` | Initialize DB: schema + test data + exchange rates |
| `npm run db:reset` | Drop and recreate schema |
| `npm run db:seed` | Load sample data (demo user + fictional accounts) |
| `npm run create-user` | Create a new user (interactive) |
| `npm run db:add-snapshot` | Add a manual balance snapshot (interactive) |
| `npm run db:import-csv` | Import balance data from CSV |
| `npm run db:refresh-rate` | Update USD/CAD exchange rate |
| `docker compose up -d` | Start app + Postgres + Caddy (Docker only) |
| `docker compose down -v` | Tear down and delete all Docker volumes |
| `bash scripts/setup-local-ssl.sh` | Trust Caddy's local CA in macOS Keychain (Docker only) |
| `./db_backup.sh backup_localhost` | Backup local database to `backups/` |
| `./db_backup.sh backup_prd` | Backup production database to `backups/` |
| `./db_backup.sh prd_to_localhost` | Snapshot local DB, then restore production data locally |

## AWS Deployment

See [`terraform/README.md`](terraform/README.md) for infrastructure setup, Terraform usage, and GitHub Actions configuration.

## Project Structure

```
server.js              # All backend routes and logic (exports app for Lambda)
lambda.js              # AWS Lambda handler (wraps Express via serverless-express)
Dockerfile             # Container image for local Docker
Dockerfile.lambda      # Container image for AWS Lambda
public/
  index.html           # Main dashboard
  login.html           # Login page
  connect.html         # Plaid Link bank connection flow
  js/
    dashboard.js       # Dashboard UI, charts, and data fetching
    login.js           # Login form handling
    connect.js         # Plaid Link integration
db/
  schema.sql           # Database schema
  create_user.js       # User creation script
  refresh_exchange_rate.js  # FX rate updater
  import_csv.js        # CSV import tool
  add_manual_snapshot.js    # Manual snapshot entry
terraform/             # Infrastructure as code — see terraform/README.md
.github/workflows/
  deploy.yml           # Build + push Lambda image, deploy on push to main
```
