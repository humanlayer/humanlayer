-- Data-only migration. Deliberately separate from 0095 (which carries the `SET DEFAULT true`):
-- a DEFAULT is derivable from the schema snapshot and a data backfill is not, so if 0095 is ever
-- renumbered or regenerated during a rebase — routine in this repo, see the
-- `rebase-drizzle-migration` skill — regeneration reproduces the DDL and would silently drop an
-- inlined UPDATE, leaving every existing member excluded and the org opt-in collecting nothing.
--
-- Why a backfill is needed at all: the DEFAULT in 0095 only applies to rows INSERTed from here on.
-- 0094 added this column as DEFAULT false, so every member who already has a settings row is
-- excluded until this runs.
--
-- The cutoff preserves deliberate exclusions. `auth.admin.users.setMetricsAdvancedEnabled` is the
-- column's only writer and it shipped in 0094's PR (#2044, merged 2026-08-10T19:25:44Z =
-- 1786389944000). A `false` on a row last written BEFORE that instant therefore cannot have come
-- from that procedure — it is 0094's column default, or an unrelated settings write (a theme
-- change) that inherited it. Rows touched at or after the boundary are ambiguous, so they are left
-- alone: an admin may have excluded that member on purpose, and re-enabling collection for someone
-- who opted out is not recoverable after the fact.
--
-- Consequence to check per environment before relying on this: any member still excluded after the
-- deploy is either a genuine exclusion or a post-boundary write that needs a human decision.
--   SELECT organization_id, user_id, updated_at FROM user_settings
--   WHERE metrics_advanced_enabled = false;
UPDATE "user_settings"
SET "metrics_advanced_enabled" = true
WHERE "metrics_advanced_enabled" = false
  AND "updated_at" < 1786389944000;
