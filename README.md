# SmartElectricity Deployment

## Overview
Frontend: Vite + React in `web/`  
Backend: Supabase Edge Function `amber-proxy`  

## Supabase (Backend)
1) Deploy the function:
```bash
supabase functions deploy amber-proxy
```
2) Set environment variables in Supabase project:
- `AMBER_TOKEN`
- `AMBER_SITE_ID`

Function URL:
```
https://xsjrrgdgksmebavvsdxa.functions.supabase.co/amber-proxy
```

## Frontend (Local)
1) Create `web/.env`:
```
VITE_SUPABASE_FUNCTIONS_URL=https://xsjrrgdgksmebavvsdxa.functions.supabase.co/amber-proxy
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```
2) Run:
```bash
cd web
npm install
npm run dev
```

## GitHub Pages
1) Add GitHub Actions secret:
- Name: `VITE_SUPABASE_FUNCTIONS_URL`
- Value: `https://xsjrrgdgksmebavvsdxa.functions.supabase.co/amber-proxy`
- Name: `VITE_SUPABASE_ANON_KEY`
- Value: your Supabase anon key

2) Enable Pages:
- Repo Settings → Pages → Source = GitHub Actions

3) Push to `main` to deploy.

## Notes
- GitHub Pages is static. All API calls are proxied via Supabase.
- If Pages deploy fails with 404, enable Pages first.
