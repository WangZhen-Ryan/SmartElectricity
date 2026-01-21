#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install from https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

PROJECT_REF="xsjrrgdgksmebavvsdxa"

supabase link --project-ref "$PROJECT_REF"
supabase functions deploy amber-proxy

echo "Deployed amber-proxy to Supabase project $PROJECT_REF"
