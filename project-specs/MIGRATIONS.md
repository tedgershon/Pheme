# Pheme — New Migration Guide

This document lists all new SQL migrations required for the feature additions described in `features/`. Migrations must be run **manually in the Supabase SQL editor** in numeric order. The existing codebase has migrations `001` through `020`. New migrations start at `021`.

**Important:** Run these in order. Some migrations depend on tables or columns created by earlier ones.

---

## Migration Summary Table

| # | File | Feature | Description |
|---|------|---------|-------------|
| 021 | `021_role_system.sql` | 01 Admin System | Add `role` column to profiles, seed super admin |
| 022 | `022_admin_rls_policies.sql` | 01 Admin System | Admin RLS policies for markets, transactions, profiles |
| 025 | `025_market_approval_workflow.sql` | 02 Market Creation | Expand market status with `pending_review`, `denied`; change default |
| 026 | `026_market_review_columns.sql` | 02 Market Creation | Add `reviewed_by`, `review_date`, `review_notes`, `link` to markets |
| 027 | `027_fn_approve_market.sql` | 02 Market Creation | `approve_market()` function |
| 028 | `028_fn_deny_market.sql` | 02 Market Creation | `deny_market()` function |
| 029 | `029_market_type.sql` | 03 Multichoice | Add `market_type`, `multichoice_type` to markets |
| 030 | `030_market_options.sql` | 03 Multichoice | Create `market_options` table |
| 031 | `031_multichoice_bets.sql` | 03 Multichoice | Extend `bets` with `option_id` for multichoice |
| 032 | `032_fn_place_multichoice_bet.sql` | 03 Multichoice | `place_multichoice_bet()` function |
| 033 | `033_fn_resolve_multichoice.sql` | 03 Multichoice | `resolve_multichoice_market()` function |
| 034 | `034_resolution_window.sql` | 04 Resolution | Add `resolution_window_end` to markets; create `community_votes` table |
| 035 | `035_fn_cast_community_vote.sql` | 04 Resolution | `cast_community_vote()` function |
| 036 | `036_voter_reward_type.sql` | 04 Resolution | Add `resolution_vote_reward` to transaction type constraint |
| 037 | `037_fn_auto_resolution_window.sql` | 04 Resolution | Trigger to auto-set 24h window on close; update `close_expired_markets()` |
| 038 | `038_fn_claim_daily_capped.sql` | 05 Coin Claiming | Updated `claim_daily_bananas()` with 5,000 cap |
| 039 | `039_fn_check_claim_eligibility.sql` | 05 Coin Claiming | `check_claim_eligibility()` function for UI |
| ~~040~~ | ~~removed~~ | ~~06 User Profile~~ | ~~Avatar URL column removed — no longer needed~~ |
| 041 | `041_notifications_table.sql` | 07 Notifications | Create `notifications` table with RLS |
| 042 | `042_fn_unread_count.sql` | 07 Notifications | `get_unread_notification_count()` function |
| 044 | `044_badge_definitions.sql` | 09 Rewards | Create `badge_definitions` table, seed 25 badges |
| 045 | `045_user_badges.sql` | 09 Rewards | Create `user_badges` table |
| 046 | `046_fn_check_badges.sql` | 09 Rewards | `check_and_award_badges()` function |
| 047 | `047_harden_place_bet.sql` | 10 Safety | Hardened `place_bet()` with `close_at` timestamp check |
| 048 | `048_restrict_market_updates.sql` | 10 Safety | Remove creator update policy; add resolved market guard trigger |
| 049 | `049_fn_admin_backroll.sql` | 10 Safety | `admin_backroll_market()` function |
| 062 | `062_badge_definitions_rls.sql` | 09 Rewards | Enable RLS + public SELECT policy on `badge_definitions` (closes Supabase linter finding) |

**Note:** Numbers 023–024 and 043 are intentionally skipped (reserved for future use within those features if needed).

---

## Execution Order by Phase

### Phase 1 — Foundation

Run these first (no cross-dependencies):

```
021_role_system.sql
022_admin_rls_policies.sql
038_fn_claim_daily_capped.sql
039_fn_check_claim_eligibility.sql
```

### Phase 2 — Core Workflow

Run these after Phase 1:

```
025_market_approval_workflow.sql
026_market_review_columns.sql
027_fn_approve_market.sql
028_fn_deny_market.sql
034_resolution_window.sql
035_fn_cast_community_vote.sql
036_voter_reward_type.sql
037_fn_auto_resolution_window.sql
047_harden_place_bet.sql
048_restrict_market_updates.sql
049_fn_admin_backroll.sql
```

### Phase 3 — Extended Features

Run these after Phase 2:

```
029_market_type.sql
030_market_options.sql
031_multichoice_bets.sql
032_fn_place_multichoice_bet.sql
033_fn_resolve_multichoice.sql
041_notifications_table.sql
042_fn_unread_count.sql
```

### Phase 4 — Polish

Run these after Phase 3:

```
044_badge_definitions.sql
062_badge_definitions_rls.sql
045_user_badges.sql
046_fn_check_badges.sql
```

---

## Notes for Running Migrations

1. **Access the Supabase SQL Editor:** Go to your Supabase project dashboard → SQL Editor.
2. **Copy-paste each migration file** in order and execute it.
3. **Verify each migration:** After running, check the affected tables in the Table Editor to confirm columns/tables were created.
4. **If a migration fails:**
   - Check if a prior migration was skipped.
   - Check if a table/column already exists (use `IF NOT EXISTS` where possible).
   - Check the error message for constraint violations or naming conflicts.
5. **For the `pg_cron` schedule** in `037`: If you're not on Supabase Pro, the `pg_cron` extension won't be available. The lazy transition logic in the API layer handles market closing as a fallback.
6. **Super admin seed** in `021`: This assumes a user with `andrew_id = 'tgershon'` already exists in the `profiles` table. If not, the UPDATE will affect 0 rows (no error). The super admin will be set once that user signs up.

---

## Rollback Instructions

If you need to undo a migration, here are the key reversal commands. Execute these carefully:

```sql
-- Rollback 021 (role system)
ALTER TABLE profiles DROP COLUMN IF EXISTS role;
DROP TRIGGER IF EXISTS sync_is_admin ON profiles;
DROP FUNCTION IF EXISTS profiles_is_admin_sync();

-- Rollback 025 (market approval)
ALTER TABLE markets ALTER COLUMN status SET DEFAULT 'open';
-- Note: status constraint rollback requires care if markets exist with new statuses

-- Rollback 030 (market options)
DROP TABLE IF EXISTS market_options CASCADE;

-- Rollback 034 (community votes)
DROP TABLE IF EXISTS community_votes CASCADE;
ALTER TABLE markets DROP COLUMN IF EXISTS resolution_window_end;

-- Rollback 041 (notifications)
DROP TABLE IF EXISTS notifications CASCADE;

-- Rollback 044-045 (badges)
DROP TABLE IF EXISTS user_badges CASCADE;
DROP TABLE IF EXISTS badge_definitions CASCADE;

-- Rollback 062 (badge_definitions RLS)
DROP POLICY IF EXISTS "Badge definitions are viewable by everyone" ON badge_definitions;
ALTER TABLE badge_definitions DISABLE ROW LEVEL SECURITY;
```

**Warning:** Rollbacks on production data should be done with extreme caution. Always backup first.
