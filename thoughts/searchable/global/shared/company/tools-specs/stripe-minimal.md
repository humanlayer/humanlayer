---
summary: Minimal Stripe metrics tool spec
last_updated: 2025-06-26
last_updated_by: dex
last_update: Created minimal version
---

# Stripe Metrics Tool - Minimal Spec

## Purpose
Get MRR and customer count from Stripe API.

## Implementation
```bash
#!/usr/bin/env python3
# tools/stripe-metrics.py

import os
import stripe
from datetime import datetime

stripe.api_key = os.environ['STRIPE_API_KEY']

# Get all active subscriptions
subscriptions = stripe.Subscription.list(status='active', limit=100)

# Calculate MRR
mrr = sum(sub.plan.amount * sub.quantity for sub in subscriptions.data) / 100

# Count unique customers
customers = len(set(sub.customer for sub in subscriptions.data))

# Output
print(f"MRR: ${mrr:,.0f}")
print(f"Customers: {customers}")

# Update metrics file
with open('metrics/README.md', 'r+') as f:
    content = f.read()
    # Update MRR line
    content = re.sub(r'MRR: \$[\d,]+', f'MRR: ${mrr:,.0f}', content)
    # Update customers line
    content = re.sub(r'Customers: \d+', f'Customers: {customers}', content)
    f.seek(0)
    f.write(content)
    f.truncate()
```

## Human Setup
1. Get Stripe API key from dashboard.stripe.com → Developers → API keys
2. Add to GitHub: Settings → Secrets → Actions → New secret
   - Name: `STRIPE_API_KEY`
   - Value: `sk_live_...`

## Usage in GitHub Actions
```yaml
- run: python tools/stripe-metrics.py
  env:
    STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
```

## Output
Updates these lines in `metrics/README.md`:
- `MRR: $12,450`
- `Customers: 89`