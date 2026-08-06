# Skipper Management

Multi-tenant SaaS for fishing vessel operations — sales notes, quota, crew shares
and daily market prices.

Every vessel is a separate business with its own skipper, quota and sales. Fleet
isolation is enforced in Postgres by restrictive RLS policies, not in the client.

## Stack

- Vite + React front end
- Supabase — Postgres, auth and RLS
- Netlify — hosting, plus Netlify Functions for the sales-note parsers
- Email ingest: CloudMailin → Netlify Function → `parseMarketFromDoc` → Supabase

## Running locally

```bash
npm install
npm run dev
```

`npm run build` produces the production bundle, `npm run preview` serves it.

Supabase credentials are read from the environment; the app will not start
without them.

## Deployment

Netlify builds from `main` on push. **Never deploy to Netlify directly** — GitHub
is the build source, and a direct deploy is overwritten by the next push.

## Modules

Dashboard · Fish Sales · Sales Insights · Daily Prices · Where to Land /
Estimator · Square Up · Crew · Contracts · Landings · Month Closeout ·
One-Off Bonuses · Rota · Quota · Price vs Fleet · Alerts · Forecast · Crew List

## Parsers

Supported sales notes: Peterhead / Don (P&J Johnstone), Hanstholm Afregning
(DKK → GBP via ECB cross-rate), Hanstholm GBP Invoice, Shetland (LHD + SSA),
Scrabster.

`netlify/functions/parse-core.cjs` is kept byte-identical to `parse-core.js` in
`davgatt86/fish-sales-tracker`. Any fix must be applied to both and the version
bumped.
