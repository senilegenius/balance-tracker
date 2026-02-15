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

- Node.js >= 24
- PostgreSQL
- Plaid developer account (for bank connections)

## Setup

1. Clone the repo and install dependencies:

   ```bash
   git clone <repo-url>
   cd my-balance-tracker
   npm install
   ```

2. Create a `.env` file with the required variables:

   ```
   PLAID_CLIENT_ID=
   PLAID_SECRET=
   PLAID_ENV=sandbox
   DATABASE_URL=
   DATABASE_URL_LOCAL=postgresql://localhost/balance_tracker
   DB_ENCRYPTION_KEY=
   SESSION_SECRET=
   ALLOWED_ORIGIN=http://localhost:3000
   NODE_ENV=development
   ```

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

   The app runs at `http://localhost:3000`.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the server |
| `npm run db:setup` | Initialize DB (schema + test data + exchange rates) |
| `npm run db:reset` | Drop and recreate schema |
| `npm run create-user` | Create a new user (interactive) |
| `npm run db:add-snapshot` | Add a manual balance snapshot (interactive) |
| `npm run db:import-csv` | Import balance data from CSV |
| `npm run db:refresh-rate` | Update USD/CAD exchange rate |

## Project Structure

```
server.js              # All backend routes and logic
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
```
