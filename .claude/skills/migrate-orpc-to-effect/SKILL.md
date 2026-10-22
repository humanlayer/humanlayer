---
name: migrate-orpc-to-effect
description: Migrate a single oRPC procedure from classic async handler to Effect-backed implementation. Use when converting procedures one at a time to maintain incremental, reviewable changes.
version: "1.1.0"
---

# Migrate oRPC Procedure to Effect

Converts a single classic oRPC procedure to an Effect-backed implementation while preserving route shape, response contract, and authorization semantics.

## When to Use

- Converting procedures that only use services we have Effect wrappers for
- Incremental Effect migration where you want one procedure per commit/PR
- Procedure does not already use Effect (no `from 'effect'` import)

## Available Effect Services

**IMPORTANT: Always check the source of truth for available services:**

```bash
# Check AppRuntimeServices type for available Effect services
cat apps/riptide-api/src/effects/app-runtime.ts | head -50
```

Only migrate procedures that use services available in `appRuntime`. The `AppRuntimeServices` type in `apps/riptide-api/src/effects/app-runtime.ts` is the authoritative list.

**Key services to look for:**
- `PostgresDb` - for database access (replaces `context.services.db`)
- `S3` - for S3 operations (replaces `context.services.s3`)
- `StripeService` - for Stripe billing operations (replaces eligible `context.services.stripe` usage)
- Check `effects/services/` directory for other available services

**If a procedure uses a classic service not in `AppRuntimeServices`, do NOT migrate it.**

## Prerequisites

Before starting, verify the target procedure is eligible:

```bash
# 1. Check what services the procedure uses
rg 'services\.' <file>

# 2. Check what Effect services are available in the runtime
cat apps/riptide-api/src/effects/app-runtime.ts | grep -A20 'AppRuntimeServices'

# 3. Confirm procedure hasn't already been migrated
rg "from 'effect'" <file>
# If matches, procedure is already migrated
```

If the procedure uses any service from `context.services` that doesn't have a corresponding Effect service in `AppRuntimeServices`, **do NOT migrate it**.

Stripe procedures are eligible only when they can call the public Effect `StripeService` from
`apps/riptide-api/src/effects/services/stripe/stripe.service.ts`. Do not call the Stripe TypeScript
SDK directly from a migrated oRPC procedure. Load and follow the `effect-program-design` skill for
Stripe migrations. `STRIPE_SECRET_KEY` may only be consumed through `Config.redacted` in the Stripe
HTTP adapter and must never be printed, inspected, or threaded through procedure code. `kv` remains
unavailable; there is no generic `KvService` for migrated procedures.

## Migration Workflow

### 1. Identify the procedure to migrate

Read the source file and understand:
- Which base it uses (`apiBaseOrgRequired`, `daemonBase`, `apiBaseForOrganizationAdmin`, etc.)
- The route path (e.g., `comments.delete`, `settings.get`)
- Input/output contract
- Authorization requirements
- Database operations (queries, transactions)
- Error handling patterns

### 2. Determine the Effect base

Map the classic base to its Effect equivalent:

| Classic Base | Effect Base |
|--------------|-------------|
| `apiBaseOrgRequired` | `effectOrpcBaseOrganizationRequired` |
| `apiBasePublic` | `effectOrpcBasePublic` |
| `apiBaseForOrganizationAdmin` | `effectOrpcBaseForOrganizationAdmin` |
| `daemonBase` | `effectOrpcDaemonBase` |

All Effect bases are exported from `apps/riptide-api/src/orpc/effect-base.ts`.

### 3. Create the Effect procedure file

Create a new file with `.effect.ts` suffix alongside the original:

```
apps/riptide-api/src/orpc/api/comments/delete.ts      # original
apps/riptide-api/src/orpc/api/comments/delete.effect.ts  # new Effect version
```

### 4. Write the Effect procedure

Follow the golden pattern structure:

```typescript
import { /* drizzle tables */ } from '@humanlayer/db/tables/...'
import { /* drizzle operators */ } from 'drizzle-orm'
import { Effect } from 'effect'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const deleteCommentEffectProcedure = effectOrpcBaseOrganizationRequired.comments.delete
  .effect(function* ({ input, context, errors }) {
    // 1. Yield services from runtime
    const postgres = yield* PostgresDb

    // 2. Extract auth context
    const { userId, organizationId } = context.auth

    // 3. Implement logic using Effect patterns
    const result = yield* postgres.transaction((tx) =>
      Effect.gen(function* () {
        // Query using tx.query() wrapper
        const [comment] = yield* tx.query(
          tx.client
            .select()
            .from(artifactComments)
            .where(eq(artifactComments.id, input.commentId))
            .limit(1)
        )

        // Fail with oRPC errors using Effect.fail
        if (!comment) {
          return yield* Effect.fail(
            errors.NOT_FOUND({ data: { message: 'Comment not found' } })
          )
        }

        // Continue with business logic...
        
        const transactionId = yield* getTransactionId(tx)
        return { success: true, transactionId }
      })
    ).pipe(
      // Log errors for observability
      Effect.tapError((e) => Effect.logError(e)),
      // Capture to Sentry
      Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
      // Map tagged Postgres errors to oRPC responses
      Effect.catchTags({
        PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
        PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
      })
    )

    // 4. Log success with structured context
    yield* Effect.logInfo('Comment deleted').pipe(
      Effect.annotateLogs({ commentId: input.commentId, userId })
    )

    return result
  })
```

### 5. Key transformation patterns

#### Service access

Before (classic):
```typescript
const { db } = context.services
```

After (Effect):
```typescript
const postgres = yield* PostgresDb
```

#### Simple queries

Before:
```typescript
const rows = await db.select().from(table).where(condition)
```

After:
```typescript
const rows = yield* postgres.query(
  postgres.client.select().from(table).where(condition)
)
```

#### Transactions

Before:
```typescript
return await db.transaction(async (tx) => {
  const [row] = await tx.select()...
  await tx.update()...
  return result
})
```

After:
```typescript
return yield* postgres.transaction((tx) =>
  Effect.gen(function* () {
    const [row] = yield* tx.query(tx.client.select()...)
    yield* tx.query(tx.client.update()...)
    return result
  })
)
```

#### Error handling

Before:
```typescript
if (!found) {
  throw errors.NOT_FOUND({ data: { message: '...' } })
}
```

After:
```typescript
if (!found) {
  return yield* Effect.fail(
    errors.NOT_FOUND({ data: { message: '...' } })
  )
}
```

#### Parallel queries

Before:
```typescript
const [a, b, c] = await Promise.all([
  db.select().from(tableA)...,
  db.select().from(tableB)...,
  db.select().from(tableC)...,
])
```

After:
```typescript
const [a, b, c] = yield* Effect.all([
  postgres.query(postgres.client.select().from(tableA)...),
  postgres.query(postgres.client.select().from(tableB)...),
  postgres.query(postgres.client.select().from(tableC)...),
], { concurrency: 'unbounded' })
```

#### Catching and re-throwing

Before:
```typescript
try {
  // logic
} catch (error) {
  if (error instanceof ORPCError) throw error
  logger.error(error, 'Failed')
  throw errors.INTERNAL_SERVER_ERROR()
}
```

After (use `.pipe()` with error handling chain):
```typescript
return yield* someEffect.pipe(
  // Log errors before mapping
  Effect.tapError((e) => Effect.logError(e)),
  // Capture to Sentry
  Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
  // Map to oRPC errors
  Effect.mapError((error) =>
    error.retryable
      ? errors.SERVICE_UNAVAILABLE()
      : errors.INTERNAL_SERVER_ERROR()
  )
)
```

#### Effect logging

Replace classic logger calls with Effect logging:

Before:
```typescript
logger.info({ taskId, userId }, 'Task created')
logger.error(error, 'Failed to create task')
```

After:
```typescript
// Info logging with annotations
yield* Effect.logInfo('Task created').pipe(
  Effect.annotateLogs({ taskId, userId })
)

// Error logging (usually via tapError in a pipe)
Effect.tapError((e) => Effect.logError(e))

// Warning logging
yield* Effect.logWarning('Deprecated endpoint called').pipe(
  Effect.annotateLogs({ endpoint: 'old-api' })
)
```

Effect logs are automatically sent to Sentry via `SentryEffectLogger` configured in `appRuntime`.

### 6. Add billing middleware if needed

If the original procedure uses billing middleware:

Before:
```typescript
export const proc = apiBaseOrgRequired.route.path
  .use(requiresBillingMiddleware)
  .handler(async ({ ... }) => { ... })
```

After:
```typescript
export const procEffect = effectOrpcBaseOrganizationRequired.route.path
  .use(requiresBillingEffectMiddleware)
  .effect(function* ({ ... }) { ... })
```

### 7. Update the router

In `apps/riptide-api/src/orpc/router.ts`, swap the procedure import:

Before:
```typescript
import { deleteCommentProcedure } from './api/comments/delete'
// ...
comments: {
  delete: deleteCommentProcedure,
}
```

After:
```typescript
import { deleteCommentEffectProcedure } from './api/comments/delete.effect'
// ...
comments: {
  delete: deleteCommentEffectProcedure,
}
```

### 8. Delete the original file

Once the Effect procedure is wired in and tests pass, delete the original `.ts` file.

### 9. Validate the change

Run validation commands (typecheck and lint only - tests require Docker containers and run in CI):

```bash
# Package typecheck
bun --bun run typecheck --filter @humanlayer/riptide-api

# Linting and formatting
bun --bun run quality
```

**Do NOT run tests locally** - the riptide-api tests require Docker containers (Postgres, Electric SQL) that are set up by CI. The CI workflow will validate the migration.

## Effect Service Reference

**This list may be out of date. Always check the source of truth:**

```bash
# Authoritative list of available services
cat apps/riptide-api/src/effects/app-runtime.ts | grep -A20 'AppRuntimeServices'

# Browse available service implementations
ls apps/riptide-api/src/effects/services/
```

Common services (verify availability before using):

| Service | Import Path | Usage |
|---------|-------------|-------|
| `PostgresDb` | `effects/services/postgres/postgres-db.service` | Database queries/transactions |
| `S3` | `effects/services/s3/s3.service` | Presigned URLs |
| `StripeService` | `effects/services/stripe/stripe.service` | Stripe billing operations through the public Effect surface |

Check the `effects/services/` directory for other available services and their implementations.

## Helper Functions

Common helpers in `effects/services/postgres/helpers.ts`:

- `getTransactionId(tx)` - Get Postgres transaction ID
- `requireTaskReadPermission(tx, { taskId, userId, organizationId })` - Check task read access
- `requireTaskEditPermission(tx, { taskId, userId, organizationId })` - Check task edit access

Error mapping in `effects/services/postgres/error-mapping.ts`:

- `mapPostgresErrorToResponse(error, errors)` - Convert Postgres errors to oRPC errors

## Review Checklist

Before committing:

- [ ] New file uses `.effect.ts` suffix
- [ ] Uses correct Effect base matching the original authorization level
- [ ] Services obtained via `yield*` from runtime, not `context.services`
- [ ] All queries wrapped with `postgres.query()` or `postgres.transaction()`
- [ ] Errors returned via `Effect.fail()`, not `throw`
- [ ] Postgres errors logged via `Effect.tapError((e) => Effect.logError(e))`
- [ ] Postgres errors captured via `Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e)))`
- [ ] Postgres errors mapped to oRPC responses via `Effect.catchTags` or `mapPostgresErrorToResponse`
- [ ] Success logging added via `Effect.logInfo()` with `Effect.annotateLogs()` for context
- [ ] Billing middleware added if original had it
- [ ] Router updated to use Effect procedure
- [ ] Original file deleted
- [ ] Typecheck passes for riptide-api package
- [ ] Tests pass for riptide-api package

## Anti-Patterns to Avoid

- Accessing `context.services.db` directly (use `PostgresDb` from runtime)
- Using `throw` for errors inside Effect generators (use `Effect.fail`)
- Forgetting to wrap raw Drizzle queries with `postgres.query()`
- Mixing `async/await` with Effect generators
- Creating new runtime/layers per procedure (use shared `appRuntime`)
- Migrating procedures that use services without Effect wrappers (jira, linear, kv, billingAccess)
- Calling the Stripe TypeScript SDK directly from migrated procedures; use `StripeService` instead
- Forgetting error logging with `Effect.tapError` before mapping errors
- Using classic `logger.info/error` instead of `Effect.logInfo/logError`
- Omitting `Sentry.captureException` in error handling chains

## Example Migration

See these files for reference implementations:

- Simple query: `apps/riptide-api/src/orpc/api/hosts/alias-list.effect.ts`
- With transaction + logging: `apps/riptide-api/src/orpc/api/comments/update.effect.ts`
- With billing + full error chain: `apps/riptide-api/src/orpc/api/uploads/create.effect.ts`
- With S3 service: `apps/riptide-api/src/orpc/api/uploads/download-url.effect.ts`

## Quick Reference: Error Handling Chain

The standard error handling pattern for transactions:

```typescript
yield* postgres.transaction((tx) =>
  Effect.gen(function* () {
    // ... transaction logic
  })
).pipe(
  Effect.tapError((e) => Effect.logError(e)),
  Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
  Effect.catchTags({
    TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
    TaskPermissionDeniedError: () => Effect.fail(errors.FORBIDDEN()),
    PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
    PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
  })
)
```

## Effect Testing Patterns

Tests for Effect procedures use `@effect/vitest` and require Docker containers (Postgres, Electric SQL). 
**Tests run in CI only** - do not attempt to run locally without the test infrastructure.

### Unit tests with `it.effect`

For testing Effect services in isolation:

```typescript
import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

describe('MyService', () => {
  it.effect('does something', () =>
    Effect.gen(function* () {
      const service = yield* MyService
      const result = yield* service.doSomething()
      expect(result).toBe('expected')
    }).pipe(
      Effect.provide(makeTestLayer())
    )
  )

  it.effect('handles errors', ({ expect }) =>
    Effect.gen(function* () {
      const service = yield* MyService
      const result = yield* Effect.result(service.failingOperation())
      expect(Result.isFailure(result)).toBe(true)
    }).pipe(
      Effect.provide(makeTestLayer())
    )
  )
})
```

### Integration tests with test database

For testing Effect procedures against a real database:

```typescript
import { call } from '@orpc/server'
import { beforeAll, afterAll, describe, test, expect } from 'vitest'
import { myEffectProcedure as liveProcedure } from '../../src/orpc/api/my/procedure.effect'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { createTestDb } from '../utils/test-db'

describe('my effect procedure', async () => {
  let db: ReturnType<typeof drizzle>
  let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
  let myProcedure: typeof liveProcedure

  beforeAll(async () => {
    const testDb = await createTestDb('my_procedure_test')
    db = testDb.db
    effectRuntime = createRuntimeWithTestPostgresLayer(db)
    myProcedure = bindProcedureToRuntime(liveProcedure, effectRuntime)
  })

  afterAll(async () => {
    await effectRuntime?.dispose()
  })

  test('does the thing', async () => {
    const result = await call(myProcedure, { input }, { context: makeContext() })
    expect(result).toEqual({ expected: 'value' })
  })
})
```

See `apps/riptide-api/test/procedures/list-effect-procedures.test.ts` for a complete example.

## Important Notes

- **Do NOT modify this skill file** - it is maintained separately
- **Do NOT run tests locally** - they require Docker infrastructure set up by CI
- **Do NOT migrate procedures using unavailable services** - check the availability table first
- **Always validate with typecheck and quality** before committing
