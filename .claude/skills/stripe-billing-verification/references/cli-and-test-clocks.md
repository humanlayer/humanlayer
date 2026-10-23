# Stripe CLI and Test Clock reference

This reference supports the `stripe-billing-verification` skill with longer-form caveats for Phase 2 webhook verification work in `apps/riptide-api`.

## Raw-body verification rules

Stripe signs the exact request payload it sends. Signature verification requires all of the following to match exactly:

- the untouched raw UTF-8 request body
- the `Stripe-Signature` header
- the signing secret for the delivery path that sent the event

If the body is parsed, reserialized, or otherwise transformed before verification, `stripe.webhooks.constructEvent(...)` fails.

## CLI forwarding vs Dashboard endpoint secrets

There are two common secret sources for Phase 2 workflows:

- Stripe CLI forwarding secret from `stripe listen --print-secret`
- Dashboard or Workbench endpoint signing secret from the configured public webhook endpoint

These secrets are different. The most common Phase 2 failure is running local CLI forwarding while the server is still configured with the Dashboard secret, or vice versa.

## Why `stripe listen --print-secret` and `stripe listen --forward-to ...` are separate

`stripe listen --print-secret` is a one-shot discovery command.

- it prints the signing secret
- it exits immediately
- it does not keep a forwarding session open

That behavior is useful for automation because it avoids scraping a long-running process for human-formatted output. After capturing the secret, start the actual forwarding listener as a separate process.

## Capture listener output with `tee`

The long-running Stripe CLI listener stays attached by design, so preserve its startup and forwarding output by teeing it to a file:

```bash
LISTENER_LOG=/tmp/stripe-billing-verification/stripe-listen.log
mkdir -p "$(dirname "$LISTENER_LOG")"
stripe listen --forward-to http://localhost:8700/webhooks/stripe \
  2>&1 | tee "$LISTENER_LOG"
```

Why this helps:

- you keep immediate readiness feedback in the terminal
- you can inspect forwarded event ids and response codes later without rerunning the listener
- agents can read the log file even though the foreground process remains open

## Local riptide dev logs

When Stripe forwarding succeeds but the local stack still misbehaves, inspect the dev logs in:

```bash
~/.humanlayer/riptide/logs/
```

Useful command:

```bash
ls -tr -la ~/.humanlayer/riptide/logs/ | tail -n 10
```

- `riptide-daemon-dev-...` files help when daemon-side flows fail after webhook intake
- `riptide-api-dev-...` files help when the webhook route returns errors or logs stack traces
- use the newest matching file after each smoke test or lifecycle run

## `stripe trigger` limitations

`stripe trigger` is useful for smoke tests, but it is not a full billing simulator.

- it uses predefined fixtures
- one trigger can emit multiple related events
- it is good for route acceptance and logging checks
- it is not a substitute for real lifecycle progression

Use Test Clocks when you need deterministic billing-time control.

## Test Clock constraints

Test Clocks are the right Phase 2 tool for lifecycle simulation, with a few caveats:

- use Stripe test mode only
- create fresh customers attached to the Test Clock
- wait for `test_helpers.test_clock.ready` before asserting final state
- treat `test_helpers.test_clock.advancing` as an intermediate state rather than a completion signal
- renewal invoice finalization can lag behind the first time boundary; advancing an additional hour is often useful
- Checkout and Test Clocks are separate workflows in this phase because Checkout does not expose the same clock attachment flow

## Optional ngrok flow

Use ngrok only if you need Stripe to deliver to a real public HTTPS endpoint.

1. Run `ngrok http 8700`
2. Configure Stripe to deliver to `https://<subdomain>.ngrok-free.app/webhooks/stripe`
3. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`
4. Restart `riptide-api`
5. Trigger or resend events from Stripe

Do not reuse the CLI forwarding secret for this public-endpoint path.

## Operational reminders

- Restart the API after changing `STRIPE_WEBHOOK_SECRET`
- Keep the same Stripe profile and mode across CLI commands in a session
- Prefer CLI forwarding for local agent work because it is simpler and avoids Dashboard setup
- Keep Phase 2 expectations narrow: success means verified intake and acknowledgement, not billing side effects
