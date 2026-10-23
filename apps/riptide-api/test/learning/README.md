# Learning tests

This directory contains local-only learning tests for `apps/riptide-api`.

## Stripe Phase 3 tests

The Stripe learning tests in this directory are intentionally not part of the default `bun run test` path.

They:

- require authenticated Stripe CLI access
- require local `STRIPE_SECRET_KEY`
- are skipped in CI
- manage their own listener setup and teardown with `test/learning/fixtures/stripe.ts`
- exercise real Stripe CLI forwarding and real Stripe Test Clocks

Run them with:

```bash
cd apps/riptide-api && bun run test:learning
```

The default hermetic suite remains:

```bash
cd apps/riptide-api && bun run test
```

If the Stripe learning tests fail locally, first check that:

- `stripe login` has already completed
- `STRIPE_SECRET_KEY` is set in the repo root env
- no other process is already managing the same webhook forwarding path
