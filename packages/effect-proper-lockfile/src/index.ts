export {
	LockAcquireError,
	LockAlreadyReleasedError,
	LockAlreadyHeldError,
	LockCheckError,
	LockCompromisedError,
	LockReleaseError,
	type LockAcquisitionError,
	type LockReleaseFailure,
} from './errors'
export { ProperLockfileLive } from './proper-lockfile.layer'
export {
	ProperLockfile,
	type LockLease,
	type LockOptions,
	type LockRetryOptions,
	type ProperLockfileRequirements,
	type ProperLockfileShape,
} from './proper-lockfile.service'
export { releaseLockSync, type OwnedLock } from './release-lock-sync'
