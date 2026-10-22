# API Testing Guidelines

This document establishes testing patterns, anti-patterns, and lessons learned from security gap analysis for the riptide-api test suite.

---

## Table of Contents

1. [Test Infrastructure](#test-infrastructure)
2. [Mock Patterns](#mock-patterns)
3. [Access Control Testing](#access-control-testing)
4. [Inheritance & Cascade Testing](#inheritance--cascade-testing)
5. [Security Gap Analysis](#security-gap-analysis)
6. [Anti-Patterns](#anti-patterns)

---

## Test Infrastructure

### Docker Postgres Pattern

For tests requiring a real database, use the Docker Postgres pattern with unique ports per test file:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { organizations } from '@humanlayer/db'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { shutdownContainer, startPostgres18Docker } from '../utils/docker'
import { migrationsFolder } from '../utils/postgres'

describe('my test suite', async () => {
  let containerId: string
  let db: ReturnType<typeof drizzle>
  let organizationId: string

  beforeAll(async () => {
    const password = randomUUID()
    const port = 45678 // Use unique port per test file to allow parallel runs
    containerId = await startPostgres18Docker(password, port)

    db = drizzle(`postgresql://postgres:${password}@127.0.0.1:${port}/electric`)
    await db.execute(`CREATE SCHEMA IF NOT EXISTS "drizzle";`)
    await migrate(db, { migrationsFolder })

    // Seed required data
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'test organization',
        workos_organization_id: 'org_workos123',
      })
      .returning()
    organizationId = org!.id
  })

  afterAll(async () => {
    await shutdownContainer(containerId)
  })

  // Tests go here...
})
```

**Key utilities:**
- `apps/riptide-api/test/utils/docker.ts` - `startPostgres18Docker()`, `shutdownContainer()`
- `apps/riptide-api/test/utils/postgres.ts` - `migrationsFolder` path

### oRPC `call()` Pattern

For testing oRPC procedures directly (bypassing HTTP):

```typescript
import { call } from '@orpc/server'
import { apiRouter, daemonRouter } from '../../src/orpc/router'

// API endpoint test
const result = await call(
  apiRouter.tasks.create,
  {
    name: 'test task',
    slug: 'test-task',
    defaultWorkingDirectory: '/tmp',
    setupStatus: 'completed',
  },
  {
    context: {
      auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
      services: { db, workos: createMockWorkosService() },
    },
  },
)

// Daemon endpoint test
const artifactResult = await call(
  daemonRouter.artifacts.upsert,
  {
    taskId: 'task-uuid',
    fileName: 'test.md',
    content: '# Hello',
  },
  {
    context: {
      auth: createMockDaemonAuth({ userId, organizationId, hostId }),
      services: { db, workos: createMockWorkosService() },
    },
  },
)
```

**Context structure:**
- `auth`: Auth context (API or Daemon)
- `services`: Object with `db` and `workos`

---

## Mock Patterns

### Rule: Only Use Pre-Approved Mocks

**CRITICAL: Do not create ad-hoc mocks without explicit user permission.**

Only use mocks from `apps/riptide-api/test/mocks/`:
- `createMockApiAuth()` - API auth with organization
- `createMockApiAuthNoOrg()` - API auth without organization
- `createMockDaemonAuth()` - Daemon auth context
- `createMockWorkosService()` - Simple WorkOS mock (throws if method called)
- `StatefulMockWorkosService` - Stateful WorkOS mock with data management

### Auth Context Mocks

```typescript
import { createMockApiAuth, createMockDaemonAuth } from '../mocks'

// API auth (user-facing endpoints with organization)
const apiAuth = createMockApiAuth({
  userId: 'user_abc123',
  organizationId: 'org-uuid-here',
  workosOrganizationId: 'org_workos123',
})

// API auth without organization (for routes like organizations-list)
const apiAuthNoOrg = createMockApiAuthNoOrg({
  userId: 'user_abc123',
})

// Daemon auth (daemon-to-API endpoints)
const daemonAuth = createMockDaemonAuth({
  userId: 'user_abc123',
  organizationId: 'org-uuid-here',
  hostId: 'host-uuid-here',
})
```

**Default values:**
```typescript
// createMockApiAuth defaults:
{
  userId: 'test-user-id',
  organizationId: 'test-org-id',
  workosOrganizationId: 'workos-org-id',
  roles: [],
  permissions: [],
  entitlements: [],
  sessionId: 'test-session-id',
}

// createMockDaemonAuth defaults:
{
  userId: 'test-user-id',
  organizationId: 'test-org-id',
  hostId: 'test-host-id',
}
```

### WorkOS Service Mocks

**Option A: Simple mock (throws if method called unexpectedly)**
```typescript
import { createMockWorkosService } from '../mocks'

// Basic mock - throws "not implemented" if any method is called
const workos = createMockWorkosService()

// With specific method overrides
const workos = createMockWorkosService({
  userManagement: {
    getUser: async (userId) => ({
      id: userId,
      email: 'test@example.com',
      // ...
    }),
  },
})
```

**Option B: Stateful mock (manages its own state)**
```typescript
import { StatefulMockWorkosService } from '../mocks'

const workos = new StatefulMockWorkosService()

// Seed data
workos.addUser({ id: 'user-1', email: 'test@example.com' })
workos.addOrganization({ id: 'org-1', name: 'Test Org' })
workos.addMembership({ userId: 'user-1', organizationId: 'org-1' })
workos.addInvitation({ email: 'invite@example.com', organizationId: 'org-1' })

// Reset between tests
workos.reset()
```

### spyOn Pattern

Use `spyOn` sparingly and only when you need to verify a function was called:

```typescript
import { vi } from 'vitest'

// Spy on a method to verify it was called
const spy = spyOn(workos.userManagement, 'getUser')

// After test
expect(spy).toHaveBeenCalledWith('user-123')
expect(spy).toHaveBeenCalledTimes(1)

// Restore original (if needed)
spy.mockRestore()
```

**When to use spyOn:**
- Verifying a dependency was called with specific arguments
- Counting invocations
- Temporarily overriding behavior in a single test

**When NOT to use spyOn:**
- As a replacement for proper mocks (use `createMockWorkosService` instead)
- To hide implementation details (tests should verify behavior, not internals)

---

## Access Control Testing

### The Three-Actor Pattern

**CRITICAL: Every access control test MUST include three actors:**

1. **Owner** - The resource owner (`resource_owner_user_id`)
2. **Stranger** - User with no access (different org or no ACL)
3. **ACL-holder** - User with ACL access but not ownership

```typescript
describe('Access Control', () => {
  const taskOwnerUserId = 'user_owner'
  const aclHolderUserId = 'user_acl_holder'
  const strangerUserId = 'user_stranger'

  test('Owner can access resource', async () => {
    // Owner should succeed
    const result = await call(procedure, input, {
      context: { auth: createMockApiAuth({ userId: taskOwnerUserId }) }
    })
    expect(result).toBeDefined()
  })

  test('Stranger cannot access resource', async () => {
    // Stranger should get NOT_FOUND or FORBIDDEN
    await expect(
      call(procedure, input, {
        context: { auth: createMockApiAuth({ userId: strangerUserId }) }
      })
    ).rejects.toThrow()
  })

  test('ACL-holder can access resource', async () => {
    // Grant ACL access
    await db.insert(taskUserAcl).values({
      organization_id: organizationId,
      subject_user_id: aclHolderUserId,
      task_id: taskId,
      resource_owner_user_id: taskOwnerUserId,
      permission_level: 'write',
      granted_by: taskOwnerUserId,
    })

    // ACL-holder should succeed
    const result = await call(procedure, input, {
      context: { auth: createMockApiAuth({ userId: aclHolderUserId }) }
    })
    expect(result).toBeDefined()
  })
})
```

### Cross-Resource Authorization

When a procedure references another resource (e.g., `taskId`), test authorization on BOTH resources:

```typescript
describe('Session Create with Task', () => {
  test('User cannot create session for task they cannot access', async () => {
    // Create task owned by someone else
    const [task] = await db.insert(tasks).values({
      organization_id: organizationId,
      name: 'other user task',
      resource_owner_user_id: 'other_user',
    }).returning()

    // Unauthorized user tries to create session
    await expect(
      call(apiRouter.sessions.create, { taskId: task.id }, {
        context: { auth: createMockApiAuth({ userId: 'attacker' }) }
      })
    ).rejects.toThrow() // Should fail permission check
  })

  test('User cannot move session to task they cannot access', async () => {
    // Create session on user's task
    // Try to update taskId to someone else's task
    // Should fail
  })
})
```

---

## Inheritance & Cascade Testing

### Ownership Inheritance Rules

When testing inheritance, verify the complete chain:

```
Task (resource_owner_user_id: Alice)
  └── Session (resource_owner_user_id: should be Alice, created_by: whoever created it)
        ├── ConversationEvent (resource_owner_user_id: should be Alice)
        └── Approval (resource_owner_user_id: should be Alice)
  └── Artifact (resource_owner_user_id: should be Alice, created_by: whoever created it)
        └── ArtifactVersion (resource_owner_user_id: should be Alice)
```

### Cascade Testing Checklist

When testing cascade behavior, verify ALL inherited fields:

```typescript
test('Updating session task_id cascades ALL ownership fields', async () => {
  // Create session with task1 (owner: user1)
  // Create events/approvals
  // Update session to task2 (owner: user2)

  // Verify cascade - MUST check ALL fields, not just the changed one
  expect(updatedSession?.task_id).toBe(task2.id)
  expect(updatedSession?.resource_owner_user_id).toBe('user2') // Often missed!

  expect(event?.task_id).toBe(task2.id)
  expect(event?.resource_owner_user_id).toBe('user2') // Often missed!
})
```

### Cross-User Ownership Test

Always test the scenario where User A creates a resource for User B's parent:

```typescript
test('Shared user creates artifact - ownership inherited from task owner', async () => {
  // Task owned by Alice
  const [task] = await db.insert(tasks).values({
    resource_owner_user_id: 'alice',
    // ...
  }).returning()

  // Grant write access to Bob
  await db.insert(taskUserAcl).values({
    subject_user_id: 'bob',
    task_id: task.id,
    permission_level: 'write',
    // ...
  })

  // Bob creates artifact
  const result = await call(daemonRouter.artifacts.upsert, {
    taskId: task.id,
    fileName: 'test.md',
    content: '# Test',
  }, {
    context: { auth: createMockDaemonAuth({ userId: 'bob' }) }
  })

  // Verify ownership vs creator
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId))

  expect(artifact?.resource_owner_user_id).toBe('alice') // Inherited from task
  expect(artifact?.created_by).toBe('bob') // The actual creator
})
```

---

## Security Gap Analysis

The following gaps were discovered through security testing. These patterns MUST be covered in future tests.

### GAP 1: Session Ownership Inheritance

**Problem:** Sessions were using `created_by` user as `resource_owner_user_id` instead of inheriting from task.

**Required tests:**
- Session created by shared user inherits task owner's `resource_owner_user_id`
- `created_by` remains the actual creator

### GAP 2: Permission Check on Resource Creation

**Problem:** Creating a session with `taskId` didn't verify write permission to the task.

**Required tests:**
- Unauthorized user cannot create session for someone else's task
- User with read-only ACL cannot create session (requires write)

### GAP 3: ACL-Based Session Operations

**Problem:** Session update/continue/interrupt only checked `resource_owner_user_id`, not task ACL.

**Required tests:**
- User with task ACL can update/continue/interrupt sessions
- Use three-actor pattern for all session operations

### GAP 4: Target Resource Permission Check

**Problem:** Changing `session.task_id` didn't check permission on the target task.

**Required tests:**
- Cannot move session to unauthorized task ("confused deputy")
- Must have write permission on BOTH source and target

### GAP 5: Cascade on Resource Re-assignment

**Problem:** Changing `session.task_id` cascaded `task_id` but not `resource_owner_user_id`.

**Required tests:**
- All ownership fields cascade when parent reference changes
- Sub-resources (events, approvals) also update

### GAP 6: Operation-Specific ACL Checks

**Problem:** Different operations may require different permission levels.

**Required tests:**
- Read operations: read permission sufficient
- Write operations: write permission required
- Admin operations: owner-only

---

## Anti-Patterns

### DO NOT: Use Ad-Hoc Mocks

```typescript
// BAD - Don't create mocks inline
const mockDb = {
  select: () => ({ from: () => ({ where: () => [] }) })
}

// GOOD - Use established mock patterns
const workos = createMockWorkosService()
```

### DO NOT: Test Only Happy Path

```typescript
// BAD - Only tests owner can access
test('owner can update', async () => {
  const result = await call(procedure, input, { context: ownerContext })
  expect(result).toBeDefined()
})

// GOOD - Test all three actors
test('owner can update', /* ... */)
test('stranger cannot update', /* ... */)
test('ACL-holder can update', /* ... */)
```

### DO NOT: Verify Only Changed Fields

```typescript
// BAD - Only checks task_id changed
test('cascade', async () => {
  expect(session?.task_id).toBe(newTaskId)
})

// GOOD - Check ALL inherited fields
test('cascade', async () => {
  expect(session?.task_id).toBe(newTaskId)
  expect(session?.resource_owner_user_id).toBe(newTaskOwnerId)
})
```

### DO NOT: Skip Cross-Resource Authorization

```typescript
// BAD - Assumes user can reference any resource
test('create session', async () => {
  const result = await call(sessions.create, { taskId: anyTaskId }, context)
})

// GOOD - Test authorization on referenced resource
test('cannot create session for unauthorized task', async () => {
  await expect(
    call(sessions.create, { taskId: otherUserTaskId }, attackerContext)
  ).rejects.toThrow()
})
```

### DO NOT: Use `bun:test` mock/spyOn Without Approval

```typescript
// BAD - Ad-hoc mocking without pre-approved patterns
import { vi } from 'vitest'
const mockFn = mock(() => 'fake result')

// GOOD - Use approved mocks from test/mocks/
import { createMockWorkosService, StatefulMockWorkosService } from '../mocks'
```

---

## Test File Organization

```
apps/riptide-api/test/
├── mocks/                    # Pre-approved mock implementations
│   ├── auth-context.mock.ts  # Auth context mocks
│   ├── workos-service.mock.ts # WorkOS mocks (simple + stateful)
│   └── index.ts              # Re-exports all mocks
├── utils/                    # Test utilities
│   ├── docker.ts             # Docker Postgres helpers
│   └── postgres.ts           # Migration paths
├── unit/                     # Pure unit tests (no DB)
├── db/                       # Schema/constraint tests
├── api/                      # API endpoint tests (dual-write, etc.)
└── procedures/               # oRPC procedure tests
    ├── artifacts.test.ts
    ├── access-control.test.ts
    ├── inheritance-chain.test.ts
    └── ...
```

---

## Checklist for New Tests

Before submitting tests, verify:

- [ ] Uses Docker Postgres pattern (not mocked DB)
- [ ] Uses only pre-approved mocks from `test/mocks/`
- [ ] Access control tests include all three actors (owner, stranger, ACL-holder)
- [ ] Cross-resource references have authorization tests
- [ ] Cascade tests verify ALL inherited fields
- [ ] Ownership tests verify both `resource_owner_user_id` AND `created_by`
- [ ] Unique port assigned for Docker container
- [ ] `afterAll` properly shuts down Docker container
