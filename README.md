# SmartElectricity

## Overview
Frontend: Vite + React in `web/`  
Backend: Supabase Edge Function `amber-proxy`  
Hosting: Cloudflare Pages

## Supabase (Backend)
1) Deploy the function:
```bash
supabase functions deploy amber-proxy
```
2) Set environment variables in Supabase project:
- `AMBER_TOKEN`
- `AMBER_SITE_ID`
- `OPENROUTER_API_KEY`

## Frontend (Local)
1) Create `web/.env` from template:
```bash
cp web/.env.example web/.env
```
2) Fill in your Supabase project URL and anon key in `web/.env`
3) Run:
```bash
cd web
npm install
npm run dev
```

## Cloudflare Pages
1) Set environment variables in Cloudflare Pages Dashboard:
   - `VITE_SUPABASE_FUNCTIONS_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CUSTOM_DOMAIN`
2) Push to `main` to deploy.

## Cloudflare Worker (Basic Auth)
`cloudflare/worker.js` provides password protection for the site.
1) Create a Worker in Cloudflare Dashboard.
2) Copy `cloudflare/worker.js` content.
3) Set the route to your custom domain.

## Notes
- Cloudflare Pages hosts the frontend. All API calls are proxied via Supabase.
- Amber credentials are stored server-side in Supabase environment variables.
