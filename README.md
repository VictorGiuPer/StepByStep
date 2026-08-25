# StepByStep by Nadine and Victor

A private, installable habit and reward tracker for exactly two partners. The frontend is a static Vite + React PWA; Supabase owns authentication, Postgres data, RLS, transaction logic, and realtime updates.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Authenticate and link the Supabase CLI:

   ```sh
   npx supabase login
   npx supabase link --project-ref dbrqbivpskqefvvbltdn
   npx supabase db push --dry-run
   npx supabase db push
   ```

4. In Supabase Authentication settings, disable new-user sign-ups. In Authentication → Users, manually create and confirm exactly two accounts. Set each account’s `display_name` metadata to `Nadine` or `Victor`; the database trigger creates the profiles.
5. Start the app with `npm run dev`.

The database password and service-role key are never frontend variables. The publishable key is intentionally public and every data operation is protected by RLS or an authenticated RPC.

## Verification

```sh
npm run lint
npm test
npm run build
```

The SQL test at `supabase/tests/database/core_flows.sql` requires the linked development project to contain both accounts. It runs inside a transaction and rolls back all test records.

## GitHub Pages

This project is connected to [VictorGiuPer/StepByStep](https://github.com/VictorGiuPer/StepByStep). Add these repository Actions secrets and select **GitHub Actions** as the Pages source:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Pushes to `main` run tests, build with the `/StepByStep/` repository subpath, and publish `dist` to [VictorGiuPer.github.io/StepByStep](https://VictorGiuPer.github.io/StepByStep/). The PWA uses hash routing so static Pages hosting does not need SPA rewrite rules. The keep-alive workflow reuses the same two secrets.

## Core guarantees

- Habit completion, streak reconciliation, and reward confirmation are atomic database transactions.
- Point balances are always a `SUM(points_ledger.points)` read; there is no mutable balance column.
- The ledger is append-only. Backfills append only missing positive streak adjustments.
- Personal habits are visible to both partners but writable only by their owner. Shared habits can be managed and completed independently by either partner.
- Reward requests do not deduct points until the other partner confirms them.
