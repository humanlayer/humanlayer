# Upstream Parity

This package adapts the behavior of `proper-lockfile@4.1.2` at commit `9f8c303c91998e8404a911dc11c54029812bca69` from `moxystudio/node-proper-lockfile`; it is not a line-for-line port. `UPSTREAM_LICENSE` contains the upstream MIT license.

## Behavior Matrix

| Upstream behavior | Effect implementation and coverage |
|---|---|
| Atomic lock acquisition with `mkdir` | `ProperLockfileLive.acquire`; concurrent and six-process stress tests |
| Default `<target>.lock` path | Live acquisition/release test |
| Custom lock path | Custom path test, including a lock inside a target directory |
| `realpath: true` by default | Missing-target and symlink alias tests |
| `realpath: false` | Missing-target and separate symlink/target lock tests |
| Existing lock reports `ELOCKED` | Typed `LockAlreadyHeldError` test |
| Numeric and object retry options | Test-clock retry test and process stress test; supports `retries`, `factor`, `minTimeout`, `maxTimeout`, and `randomize` |
| Stale lock takeover | Real filesystem stale quarantine tests cover valid, missing, and malformed owner files; this package checks the exact owner bytes, owner state, and mtime around rename |
| Lock removed during stale inspection | Missing-path branch retries atomic acquisition without recursive stale checks |
| Stale minimum of 2 seconds | Test-clock clamp test |
| Update minimum of 1 second | Test-clock compromise timing test |
| Update maximum of `stale / 2` | Test-clock compromise timing test |
| Periodic `mtime` refresh | Live-clock real filesystem test |
| Millisecond and second `mtime` precision | Acquisition probes filesystem precision and refresh rounds to that precision; the live test covers the host filesystem precision |
| Missing lock during refresh | `LockCompromisedError` with `lock-missing` and a test-clock removal test |
| Lock replaced by another owner | Owner-token compromise test |
| Repeated refresh failure past stale deadline | `LockCompromisedError` with `refresh-overdue` and a fault-injected test-clock test |
| Release removes the lock | Scope release and explicit release tests |
| Release twice reports `ERELEASED` | Typed `LockAlreadyReleasedError` test |
| Release filesystem failure | Typed `LockReleaseError` fault-injection and retry tests |
| `check` returns live/stale/unlocked state | Live, missing, stale, and stale-clamp tests |
| Filesystem failures remain observable | Acquire/check/release fault-injection tests through a substituted `FileSystem` layer |
| Graceful process exit removes locks | Real child-process `SIGTERM` test through Effect `NodeRuntime` finalizers |
| `SIGKILL` leaves a recoverable stale lock | Real child-process `SIGKILL` and stale takeover test |
| Stress exclusivity | Six Bun processes, 25 acquisitions each, with a second atomic guard detecting overlap |
| Update timer does not outlive ownership | The monitor runs through release cleanup, remains active after a restored failed release, and stops only after removal succeeds |

## Effect API Adaptations

- Upstream callback and Promise functions become Effect service operations.
- Upstream's returned release callback becomes `LockLease.release`; normal callers should rely on scope closure or `withLock`.
- Upstream `unlock(path)` is not exposed. It depends on a process-global path registry and can release ownership without the lease. The scoped lease is the real ownership handle.
- Synchronous APIs are not exposed. This repository bans synchronous filesystem work, and Effect resource cleanup requires an asynchronous scope.
- `onCompromised` becomes the typed `LockLease.failWhenLockOwnershipIsCompromised` effect. `withLock` races it with protected work; direct lease users may race it or handle it in another scoped fiber.
- A supplied `fs` object becomes a provided Effect `FileSystem` layer. `ProperLockfileLive` does not choose or provide Node or Bun services.
- Owner IDs, exact snapshots, no-clobber restore, and unique quarantine renames narrow release and takeover races. Filesystem compare and delete cannot be made fully atomic. All cooperative callers must share one stale and update policy; see the full lease assumptions in `README.md`.

These adaptations preserve each applicable upstream behavior while keeping failures, dependencies, time, retries, and resource lifetime in Effect.
