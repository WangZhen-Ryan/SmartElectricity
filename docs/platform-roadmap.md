# Multi-User Platform Roadmap

This document defines the first production-ready platform shape for turning SmartElectricity into a multi-user product with private dashboards, public leaderboard, and regional activity.

## Architecture

### Identity
- Admin access stays behind your existing Cloudflare login.
- End users sign in through Supabase Auth.
- Recommended providers:
  - Email magic link (default)
  - Google (phase 1.5)
  - Apple (phase 2+)

### User data
- Each user owns a private config set stored in Supabase.
- Sensitive credentials are stored as encrypted payloads at the application layer before insert.
- Public community features only read rows from users who opt in with `profiles.is_public = true`.

### Real-time
- Online presence is driven by `presence_sessions`.
- Region counters read from `region_activity`.
- Leaderboards read from `leaderboard_entries`.

## Database model

### Core tables
- `profiles`
  - Public-facing identity, region, timezone, role, public visibility.
- `user_energy_configs`
  - Amber, battery, HA, Solcast, and future cloud-vendor settings.
- `strategy_profiles`
  - Named backtest/monitor strategy presets per user.
- `presence_sessions`
  - Heartbeat-style online tracking by page and region.
- `leaderboard_entries`
  - Cached score rows by daily / weekly / monthly bucket.
- `achievements`
  - Public unlocks and seasonal progress.

### Security assumptions
- `anon` can read:
  - public profiles
  - public leaderboard rows
  - online presence aggregates
- `authenticated` users can only read/write their own private config rows.
- Tokens and API secrets should be encrypted in the server layer before insert.

## Product map

### Home
- Hero dashboard
- Live edge / recommended action
- Home usage, price, solar, and scenario modules
- Public teaser widgets:
  - Online now
  - Region pulse
  - Top public traders

### Backtest
- Private, user-specific workspace
- Pull Amber data
- Save personal strategy profiles
- Auto-iteration and diagnostics
- Export snapshots

### Monitor
- Private, user-specific live dashboard
- Read-only battery and grid views
- Local Modbus, HA, or future cloud source
- Live override recommendation (design-state first, real control later)

### Config
- Setup checklist
- Per-user integrations
- Connection tests
- Secrets guidance
- Runtime status

### Leaderboard
- Scope filters:
  - Region
  - Daily / Weekly / Monthly
  - Profit / Efficiency / Composite score
- Public profile cards
- Trending users

### Community
- Region activity
- Online now
- Public feed
- Season standings

### Profile
- Public or private toggle
- Nickname, avatar, region
- Best score history
- Achievements and current season rank

## Rollout phases

### Phase 1: Private accounts
- Supabase Auth login
- Auto-create `profiles` row after signup
- Persist each user’s config to `user_energy_configs`
- Persist strategy presets to `strategy_profiles`
- Private dashboard experience only

### Phase 2: Shared activity
- Heartbeat writes to `presence_sessions`
- Home / Community show:
  - online user count
  - region activity
- Simple leaderboard:
  - daily profit
  - region filter
  - public-only rows

### Phase 3: Public competition
- Public profile pages
- Opt-in competition mode
- Achievements, tiers, seasons
- Weekly / monthly ladders
- Public strategy summaries and badges

## First-pass scoring rules

Use multiple views so large batteries do not dominate the product.

### 1. Absolute Profit
- Metric: `profit_aud`
- Best for simple headline ranking.

### 2. Efficiency Score
- Formula:
- `profit_aud / max(capacity_kwh, 1)`
- Rewards efficient use of available storage.

### 3. Composite Score
- Suggested v1:
- `score = profit_aud + (roi_pct * 0.25) + (export_kwh * 0.03) - (cycles * 0.15)`
- Then apply telemetry quality modifiers:
  - `battery-connected`: no penalty
  - `grid-only`: `score * 0.85`
  - `simulated`: `score * 0.70`

### 4. Tie-breakers
- Lower cycle count wins
- Then higher ROI wins
- Then earlier submission wins

## Regions

Recommended launch regions:
- `AU-NSW`
- `AU-VIC`
- `AU-QLD`
- `AU-SA`
- `AU-WA`
- `AU-ACT`
- `AU-TAS`
- `NZ`

Keep these as string codes so the UI can add labels and flags separately.

## Implementation notes

### Auth flow
- Use Supabase Auth in the frontend.
- On first login:
  - create `profiles` row
  - seed one `user_energy_configs` row (`Primary Setup`)
  - seed one default `strategy_profiles` row from current session defaults

### Secrets
- Never store Amber token, HA token, or Solcast API key as plaintext.
- Encrypt before insert in your server layer or edge function.
- Frontend should only display masked summaries.

### Presence
- Heartbeat every 30 seconds while the app tab is visible.
- Mark `is_online = false` on sign out / tab close if possible.
- Treat rows older than 2 minutes as offline even if cleanup has not run.

### Leaderboard refresh
- Recompute on:
  - completed backtest
  - scheduled daily rollup
  - optional hourly refresh for live ladders

### Public profile policy
- Default `is_public = false`
- User explicitly opts in to appear in leaderboard and community views

## Recommended UI sequence

### Initial launch
1. User signs in with Supabase Auth.
2. Config shows a setup checklist.
3. User saves Amber + battery source.
4. Backtest uses their own saved defaults automatically.
5. Home starts to reflect private data.

### Community opt-in
1. User enables public profile.
2. User chooses display name + region.
3. Latest leaderboard row becomes visible to others.
4. Presence contributes to online counts.

## Immediate next build tasks

1. Add Supabase Auth client to the web app.
2. Add a `ProfileProvider` / auth store in the frontend.
3. Add save/load handlers for `user_energy_configs`.
4. Add presence heartbeat endpoint or direct client writes.
5. Add leaderboard read models and region widgets.
