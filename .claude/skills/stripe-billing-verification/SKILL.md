---
name: stripe-billing-verification
description: Run Stripe webhook smoke tests and billing lifecycle simulations for stripe
---

## Task

Default to Stripe CLI forwarding for local work. Use ngrok only when the user specifically needs Stripe to deliver to a public HTTPS endpoint.

## Quick Reference

```bash
export STRIPE_WEBHOOK_SECRET="$(stripe listen --print-secret | tr -d '\r\n')"
LISTENER_LOG=/tmp/stripe-billing-verification/stripe-listen.log
mkdir -p "$(dirname "$LISTENER_LOG")"
stripe listen --forward-to http://localhost:8700/webhooks/stripe \
  2>&1 | tee "$LISTENER_LOG"
stripe trigger payment_intent.succeeded
stripe trigger customer.subscription.created
```

```bash
curl -i http://localhost:8700/webhooks/stripe \
  -X POST \
  -H 'content-type: application/json' \
  -d '{}'
```

```bash
stripe test_helpers test_clocks create --frozen-time <unix-ts>
stripe test_helpers test_clocks advance <clock-id> --frozen-time <unix-ts>
```

## Workflow

1. Ensure local `riptide-api` is running on `http://localhost:8700`
2. Capture the CLI forwarding secret with `stripe listen --print-secret`
3. Export that value as `STRIPE_WEBHOOK_SECRET`
4. Start a separate `stripe listen --forward-to http://localhost:8700/webhooks/stripe` process and tee its output to a file so the initial readiness output is preserved even though the process stays attached by design
5. Trigger smoke-test events with `stripe trigger ...`
6. For lifecycle validation, create a fresh Test Clock, attach a fresh customer, advance the clock, and wait for readiness before asserting results

## Secret Rules

- `STRIPE_WEBHOOK_SECRET` must match the delivery path in use
- Stripe CLI forwarding uses a transient CLI session secret
- Dashboard or Workbench endpoints use that endpoint's signing secret
- these secrets are not interchangeable
- if a signature check fails, first verify that the configured secret matches the traffic source

`stripe listen --print-secret` is the preferred non-interactive way to capture the local forwarding secret because it prints only the secret and exits. It does not keep the listener running.

## Captured Output and Dev Logs

When starting the long-running Stripe listener, always tee its output to a file so you keep the immediate readiness lines and forwarded event feedback:

```bash
LISTENER_LOG=/tmp/stripe-billing-verification/stripe-listen.log
mkdir -p "$(dirname "$LISTENER_LOG")"
stripe listen --forward-to http://localhost:8700/webhooks/stripe \
  2>&1 | tee "$LISTENER_LOG"
```

- the command hangs by design because the listener stays attached
- `tee` keeps the live terminal output visible and also saves it for later inspection
- after triggering events, inspect `"$LISTENER_LOG"` to confirm forwarding, event ids, and response codes

Riptide dev logs live in:

```bash
~/.humanlayer/riptide/logs/
```

To list recent dev logs:

```bash
ls -tr -la ~/.humanlayer/riptide/logs/ | tail -n 10
```

- look for `riptide-daemon-dev-...` files when checking daemon-side errors
- look for `riptide-api-dev-...` files when checking webhook handler behavior
- use those files to verify accepted events or fetch stack traces and Stripe-related errors after a smoke test

## Smoke-Test Procedure

1. Export the CLI forwarding secret:

```bash
export STRIPE_WEBHOOK_SECRET="$(stripe listen --print-secret | tr -d '\r\n')"
```

2. Start forwarding in a separate terminal:

```bash
LISTENER_LOG=/tmp/stripe-billing-verification/stripe-listen.log
mkdir -p "$(dirname "$LISTENER_LOG")"
stripe listen --forward-to http://localhost:8700/webhooks/stripe \
  2>&1 | tee "$LISTENER_LOG"
```

3. Confirm unsigned traffic fails with `400`:

```bash
curl -i http://localhost:8700/webhooks/stripe \
  -X POST \
  -H 'content-type: application/json' \
  -d '{}'
```

4. Trigger one or more smoke events:

```bash
stripe trigger payment_intent.succeeded
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
```

5. Verify that the route returns `2xx` for valid signed events and that logs include event id and type.

If you need to confirm the webhook made it through the rest of the local stack, also check the latest files in `~/.humanlayer/riptide/logs/`.

## Test Clock Workflow

Use Test Clocks for time-based billing scenarios in Stripe test mode.

- create a fresh Test Clock
- create a fresh customer attached to that clock
- create the subscription or other billing object for that customer
- advance time in steps
- wait for the clock to reach `ready`
- inspect resulting webhook traffic and Stripe object state

Important constraints:

- Checkout and Test Clocks are separate workflows in Phase 2
- Test Clocks work best with newly created customers
- renewal-related events can require advancing slightly beyond the nominal boundary because invoice finalization may lag
- if webhook acknowledgement fails, Stripe can delay lifecycle side effects

## Safe Automation Guidance

Safe to automate:

- capturing the CLI forwarding secret with `stripe listen --print-secret`
- starting and stopping local Stripe CLI forwarding
- teeing Stripe CLI listener output to a persistent file for later inspection
- sending `stripe trigger` smoke events
- polling Test Clock readiness
- explaining the correct secret-selection flow
- reading `~/.humanlayer/riptide/logs/` to confirm daemon or API-side errors

Keep manual or human-confirmed:

- Stripe Dashboard or Workbench endpoint setup
- copying endpoint signing secrets from the Dashboard
- validating a public ngrok endpoint in the Stripe UI
- decisions about which real environment endpoint to exercise

## Troubleshooting

### Invalid signature

Check whether:

- `STRIPE_WEBHOOK_SECRET` matches the active delivery path
- the API was restarted after the env change
- the listener and `--print-secret` used the same Stripe account and mode
- the route verified the untouched raw body rather than parsed JSON

### `stripe listen --print-secret` succeeded, but forwarding does not happen

That is expected. Start the long-running listener separately:

```bash
LISTENER_LOG=/tmp/stripe-billing-verification/stripe-listen.log
mkdir -p "$(dirname "$LISTENER_LOG")"
stripe listen --forward-to http://localhost:8700/webhooks/stripe \
  2>&1 | tee "$LISTENER_LOG"
```

### Need daemon or API errors after the trigger

List recent dev logs and inspect the newest `-dev-` file for the component you need:

```bash
ls -tr -la ~/.humanlayer/riptide/logs/ | tail -n 10
```

Use `riptide-daemon-dev-...` for daemon issues and `riptide-api-dev-...` for webhook-route issues.

### `stripe trigger` does not match a real billing flow

That is also expected. `stripe trigger` is for smoke testing route acceptance and basic event intake. Use Test Clocks for lifecycle progression.

## References

- `docs/stripe-billing-webhook-testing.md`
- `.claude/skills/stripe-billing-verification/references/cli-and-test-clocks.md`
