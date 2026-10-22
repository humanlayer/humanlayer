# Collaboration milestone backfill runbook

This command recovers `user_settings.first_inbound_comment_received_at` from persisted cross-user comments on design discussions, PRDs, TDDs, and structure outlines. It includes comments and artifacts that were later resolved, deleted, or soft-deleted. Hard-deleted comments or artifacts cannot be reconstructed.

## Release hold

Run and verify this backfill in every target environment before releasing Phase 2's collaboration onboarding UI. Do not use the email-campaign flag as a UI rollout gate.

## Preview one organization

Preview is the default and does not change rows:

```bash
bun --bun apps/riptide-api/scripts/backfill-collaboration-milestones.ts --organization-id <org-id>
```

Review `ownersChecked`, `ownersWithQualifyingFeedback`, `settingsRowsChanged` (always zero in preview), and `failed` without exposing comment bodies or credentials.

## Apply and verify

```bash
bun --bun apps/riptide-api/scripts/backfill-collaboration-milestones.ts --organization-id <org-id> --apply
```

Apply performs null-only writes using each owner's earliest qualifying persisted comment timestamp, then scans the same target again. The command exits nonzero if any recoverable owner still lacks the timestamp. Existing timestamps and unrelated settings remain unchanged.

Use `--all-organizations` instead of `--organization-id` only for an explicitly authorized all-organization run. Never pass both flags or omit both.

## Rerun and failure recovery

The operation pages stable owner/organization groups, is safe to interrupt, and is safe to rerun. A successful rerun after apply reports zero changed rows. If a page fails, correct the database or stored metadata problem and rerun the same target; already completed owners remain unchanged. A concurrent live comment writer wins its null-guarded race and its timestamp is preserved.

Do not run against shared or production data without explicit authorization. Record the target, preview summary, apply summary, rerun summary, and successful completeness verification as release evidence.
