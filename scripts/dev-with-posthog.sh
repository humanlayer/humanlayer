#!/bin/bash
# Helper script to run CodeLayer with PostHog enabled for local testing

echo "Starting CodeLayer with PostHog analytics (nightly key)..."
echo "Events will be sent to PostHog Codelayer (Nightly) project"
echo ""

cd humanlayer-wui && \
  VITE_PUBLIC_POSTHOG_KEY=phc_de6RVF0G7CkTzv2UvxHddSk7nfFnE5QWD7KmZV5KfSo \
  VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
  bun run dev