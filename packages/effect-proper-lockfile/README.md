# Effect Proper Lockfile

`@humanlayer/effect-proper-lockfile` provides cross-process filesystem leases for Effect programs. It adapts the atomic-directory and stale-heartbeat design from [`proper-lockfile`](https://github.com/moxystudio/node-proper-lockfile) to Effect v4.

## Design

- `ProperLockfile` is the application service.
- `ProperLockfileLive` implements it with Effect `FileSystem` and `Path` services.
- The live layer does not choose or provide a Node or Bun platform layer. The caller provides that layer once at its runtime edge.
- `acquire` creates the lock directory atomically, writes an owner ID, starts a scoped heartbeat, and removes only a lock still owned by that ID.
- Stale takeover snapshots owner and mtime, moves the candidate to a unique quarantine path, then checks that the moved candidate is the same stale lease before publishing a new lock.
- Release also moves the canonical lock to a unique quarantine, checks ownership there, and deletes only that checked directory. A failed cleanup can be retried.
- `releaseLockSync` runs the same ownership check and quarantine synchronously with `node:fs`, for `process.exit` paths that skip Effect finalizers. It is the only export that uses Node APIs directly.
- `LockLease.failWhenLockOwnershipIsCompromised` fails if the lock disappears, its owner changes, or refresh cannot complete before the stale deadline.
- `makeProperLockfileTestLayer` provides a filesystem-free implementation for consumer tests.

This is a heartbeat lease, not a kernel advisory lock. Filesystem rename, compare, and delete do not form one atomic operation. Its unavoidable safety assumptions are atomic same-filesystem directory rename, a filesystem whose directory mtime reflects heartbeat updates, and cooperative owners that use this owner-file and quarantine protocol. Every caller sharing a lock path must use one stale and update policy. Mixed stale deadlines let one caller take over a lease that another still treats as live; mixed update intervals can also break the shared timing assumptions. Code that ignores the protocol can alter or remove a live lease. A process killed with `SIGKILL` leaves its lock directory behind until the stale deadline permits takeover.

See `UPSTREAM_PARITY.md` for the mapping from every upstream behavior to this package's Effect API and tests.

## Runtime Wiring

```ts
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import * as Layer from 'effect/Layer'

const LockfileLive = Layer.mergeAll(ProperLockfileLive, NodeServices.layer)
```

## Scoped Use

```ts
import { ProperLockfile } from '@humanlayer/effect-proper-lockfile'
import * as Effect from 'effect/Effect'

const program = Effect.scoped(
	Effect.gen(function* () {
		const lockfile = yield* ProperLockfile
		const lease = yield* lockfile.acquire({
			path: '/path/to/resource',
			stale: '30 seconds',
			updateInterval: '10 seconds',
		})

		return yield* runOwnedProcess.pipe(Effect.raceFirst(lease.failWhenLockOwnershipIsCompromised))
	}),
)
```

Closing the scope stops the heartbeat and releases the lock. `withLock` races protected work against compromise and interrupts the work when the lease fails. Direct `acquire` users should also race long-running work against `failWhenLockOwnershipIsCompromised`.
