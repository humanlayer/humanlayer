# Collection Cleanup Refactor

## Problem

Electric SQL collections are not being properly cleaned up before Docker containers shut down during tests, causing 409 errors and other Electric-related errors.

## Solution

Integrate collection factory methods into the `ElectricTestContext` so that:
1. Collections are automatically tracked for cleanup
2. Tests have minimal boilerplate (single method call instead of 3 lines)
3. `shutdown()` cleans up all collections before stopping servers/containers

## Current Pattern (3 lines per collection)

```typescript
const sessionsElectric = createSessionsCollection({ server })
const sessionsCollection = wrapWithLiveQuery(sessionsElectric)
await setupLiveQuery(sessionsElectric, sessionsCollection)
```

## New Pattern (1 line per collection)

```typescript
const sessionsCollection = await ctx.createSessionsCollection({ server })
```

## Implementation Details

### 1. Add Collection Tracking to Context

Add a `trackedCollections` array to store references to all created collections:

```typescript
const trackedCollections: Array<{ cleanup: () => Promise<void> }> = []
```

### 2. Add Factory Methods to Context

Each method will:
- Call the existing factory function from `collection-factories.ts`
- Wrap with `wrapWithLiveQuery()`
- Call `setupLiveQuery()` (awaited)
- Register both electric and liveQuery collections for cleanup
- Return only the liveQuery collection (tests never use electric after setup)

Methods to add:
- `ctx.createSessionsCollection({ server })`
- `ctx.createSessionsByHostCollection({ server, hostId })`
- `ctx.createTasksCollection({ server })`
- `ctx.createEventsCollection({ server })`
- `ctx.createApprovalsCollection({ server })`
- `ctx.createDaemonApprovalsCollection({ server })`
- `ctx.createHostsCollection({ server })` - handles custom `host_id` key internally

### 3. Update `shutdown()` Order

```typescript
shutdown: async () => {
  // 1. Cleanup all tracked collections FIRST
  await Promise.all(trackedCollections.map(c => c.cleanup()))

  // 2. Stop all proxy servers
  context.stopAllServers()

  // 3. Shutdown containers
  if (!opts?.skipContainers) {
    await shutdownContainers({ ... })
  }
}
```

### 4. Cleanup Tasks

- Remove unused `createCollectionSet` from `collection-factories.ts`
- Update `fixtures/index.ts` exports (collection factories stay internal, accessed via context)
- Refactor all test files to use new `ctx.create*Collection()` pattern

## Files to Modify

1. `test/fixtures/electric-test-context.ts` - Add tracking + factory methods
2. `test/fixtures/collection-factories.ts` - Remove unused `createCollectionSet`
3. `test/fixtures/index.ts` - Update exports
4. `test/v1.sessions.test.ts` - Refactor to use ctx methods
5. `test/v1.sessions-by-host.test.ts` - Refactor to use ctx methods
6. `test/v1.tasks.test.ts` - Refactor to use ctx methods
7. `test/v1.events.test.ts` - Refactor to use ctx methods
8. `test/v1.approvals.test.ts` - Refactor to use ctx methods
9. `test/v1.daemon-approvals.test.ts` - Refactor to use ctx methods
10. `test/v1.hosts.test.ts` - Refactor to use ctx methods
11. `test/daemon-token-core.test.ts` - Refactor to use ctx methods

## Test Changes

Before:
```typescript
import {
  createElectricTestContext,
  createSessionsCollection,
  wrapWithLiveQuery,
  setupLiveQuery,
  // ...
} from './fixtures'

// In test:
const sessionsElectric = createSessionsCollection({ server })
const sessionsCollection = wrapWithLiveQuery(sessionsElectric)
await setupLiveQuery(sessionsElectric, sessionsCollection)
```

After:
```typescript
import {
  createElectricTestContext,
  // collection factories no longer imported directly
  // ...
} from './fixtures'

// In test:
const sessionsCollection = await ctx.createSessionsCollection({ server })
```

## Verification

After implementation:
1. Run `bun --bun run biome`
2. Run `bun --bun typecheck --filter @humanlayer/riptide-electric-proxy`
3. Run `bun vitest run --filter @humanlayer/riptide-electric-proxy`
4. Commit and push
