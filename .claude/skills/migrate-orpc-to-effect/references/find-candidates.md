# Finding Migration Candidates

Use ast-grep to find oRPC procedures that are good candidates for Effect migration.

## Step 1: Check available Effect services

Before finding candidates, check what services are available in the Effect runtime:

```bash
# Check AppRuntimeServices for available Effect services
cat apps/riptide-api/src/effects/app-runtime.ts | grep -A20 'AppRuntimeServices'

# List service implementations
ls apps/riptide-api/src/effects/services/
```

## Step 2: Find procedures not yet migrated

```bash
# Create ast-grep rules
cat << 'EOF' > /tmp/effect-import.yaml
id: effect-import
language: typescript
rule:
  any:
    - pattern: import { $$IMPORTS } from 'effect'
    - pattern: import { $$IMPORTS } from "effect"
EOF

# Find procedures that already use Effect (already migrated)
sg scan -r /tmp/effect-import.yaml apps/riptide-api/src/orpc --json 2>/dev/null | jq -r '.[].file' | sort -u > /tmp/effect-files.txt

# Find all procedure files (have .handler( calls)
sg --pattern '$BASE.handler($HANDLER)' --lang typescript apps/riptide-api/src/orpc 2>/dev/null | \
  cut -d: -f1 | sort -u | grep -v 'base.ts' > /tmp/all-procedures.txt

# Find not-yet-migrated procedures
comm -23 /tmp/all-procedures.txt /tmp/effect-files.txt
```

## Step 3: Check what services each candidate uses

For each candidate file, check what services it uses:

```bash
# Check services used by a specific file
rg 'services\.' <file>

# Or check all candidates
for file in $(comm -23 /tmp/all-procedures.txt /tmp/effect-files.txt); do
  echo "=== $file ==="
  rg 'context\.services|services\.' "$file" 2>/dev/null | head -5
done
```

## Step 4: Match against available Effect services

Only migrate procedures where ALL services used have Effect equivalents in `AppRuntimeServices`.

Example: If a procedure uses `context.services.db` and `context.services.stripe`, but there's no `StripeService` in `AppRuntimeServices`, do NOT migrate it.

## Quick one-liner to count candidates

```bash
sg --pattern 'const { db } = context.services' --lang typescript apps/riptide-api/src/orpc 2>/dev/null | \
  grep -v 'base.ts' | grep -v 'api/sync/' | cut -d: -f1 | sort -u | wc -l
```

## List candidates by category

After running the full script above, categorize by path:

```bash
cat /tmp/candidates.txt | while read f; do
  dir=$(dirname "$f" | sed 's|apps/riptide-api/src/orpc/||')
  echo "$dir: $(basename $f)"
done | sort
```
