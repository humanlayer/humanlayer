import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { OWNER_FILE_NAME } from './proper-lockfile.layer'
import type { LockLease } from './proper-lockfile.service'

export type OwnedLock = Pick<LockLease, 'lockPath' | 'ownerId'>

const succeeds = (operation: () => void): boolean => {
	try {
		operation()
		return true
	} catch {
		return false
	}
}

const readOwnerId = (lockPath: string): string | undefined => {
	try {
		const owner: unknown = JSON.parse(readFileSync(join(lockPath, OWNER_FILE_NAME), 'utf8'))
		if (typeof owner !== 'object' || owner === null || !('ownerId' in owner)) return undefined
		return typeof owner.ownerId === 'string' ? owner.ownerId : undefined
	} catch {
		return undefined
	}
}

/**
 * Removes a lock directory that `lock` still owns, with the same quarantine protocol as
 * `LockLease.release`, for exit paths that cannot wait for Effect finalizers. Never throws.
 */
export const releaseLockSync = (lock: OwnedLock): void => {
	if (readOwnerId(lock.lockPath) !== lock.ownerId) return
	const quarantinePath = `${lock.lockPath}.release.${randomBytes(16).toString('hex')}`
	if (!succeeds(() => renameSync(lock.lockPath, quarantinePath))) return
	if (readOwnerId(quarantinePath) === lock.ownerId) {
		succeeds(() => rmSync(quarantinePath, { recursive: true, force: true }))
		return
	}
	succeeds(() => renameSync(quarantinePath, lock.lockPath))
}
