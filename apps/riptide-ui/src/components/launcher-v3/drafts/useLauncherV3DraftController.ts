import { useState } from 'react'
import { uuidv7 } from 'uuidv7'

import type { LauncherV3DraftPersistence, LauncherV3LaunchIdentity } from '@/modules/launcher-v3/launcher-v3-drafts'

export interface LauncherV3DraftLifecycle {
	ensureId(): string
	ensureLaunchIdentity(): LauncherV3LaunchIdentity
	bindUploadsToActiveId(): string
	hasUploadBoundIdentity(): boolean
	activeId(): string | undefined
	state(): 'idle' | 'launching' | 'committed'
	markLaunching(): void
	markIdle(): void
	isCommitted(): boolean
	setActive(id: string, options?: { uploadBound?: boolean }): void
	reassignId():
		| { result: 'reassigned'; displacedId: string | undefined; replacementId: string }
		| { result: 'upload-bound-conflict'; activeId: string }
	takeDisplacedIds(savedId: string): readonly string[]
	markCommitted(taskId: string): void
	enableCommitCleanup(): void
	disableCommitCleanup(): void
}

export function createLauncherV3DraftLifecycle({
	initialId,
	initialLaunchIdentity,
	initialUploadBound = false,
	persistence,
	createId = uuidv7,
}: {
	initialId?: string
	initialLaunchIdentity?: LauncherV3LaunchIdentity
	initialUploadBound?: boolean
	persistence: LauncherV3DraftPersistence
	createId?: () => string
}): LauncherV3DraftLifecycle {
	let activeId = initialId
	let launchIdentity = initialLaunchIdentity
	let uploadBound = initialUploadBound
	let state: 'idle' | 'launching' | 'committed' = 'idle'
	let cleanupEnabled = true
	const displacedIds = new Set<string>()

	return {
		ensureId: () => (activeId ??= createId()),
		ensureLaunchIdentity() {
			const draftId = (activeId ??= createId())
			if (!launchIdentity || launchIdentity.draftId !== draftId) {
				launchIdentity = {
					draftId,
					firstSessionId: createId(),
					firstEventId: createId(),
					state: 'editing',
				}
			}
			persistence.writeLaunchIdentity(launchIdentity)
			return launchIdentity
		},
		bindUploadsToActiveId() {
			uploadBound = true
			return (activeId ??= createId())
		},
		hasUploadBoundIdentity: () => uploadBound,
		activeId: () => activeId,
		state: () => state,
		markLaunching: () => {
			if (state === 'committed') return
			state = 'launching'
			const identity = launchIdentity
			if (identity) {
				launchIdentity = { ...identity, state: 'launching' }
				persistence.writeLaunchIdentity(launchIdentity)
			}
		},
		markIdle: () => {
			if (state === 'committed') return
			state = 'idle'
			if (launchIdentity) {
				launchIdentity = { ...launchIdentity, state: 'editing' }
				persistence.writeLaunchIdentity(launchIdentity)
			}
		},
		isCommitted: () => state === 'committed',
		setActive(id, options) {
			if (state === 'committed') return
			activeId = id
			launchIdentity = persistence.readLaunchIdentity(id) ?? undefined
			uploadBound = options?.uploadBound ?? false
		},
		reassignId() {
			const previousId = activeId
			if (uploadBound) return { result: 'upload-bound-conflict', activeId: (activeId ??= createId()) }
			if (state === 'committed') {
				return { result: 'reassigned', displacedId: previousId, replacementId: activeId ?? createId() }
			}
			activeId = createId()
			launchIdentity = undefined
			if (previousId && previousId !== activeId) {
				displacedIds.add(previousId)
				persistence.removeLaunchIdentity(previousId)
			}
			return { result: 'reassigned', displacedId: previousId, replacementId: activeId }
		},
		takeDisplacedIds(savedId) {
			const result = [...displacedIds].filter((id) => id !== savedId)
			displacedIds.clear()
			return result
		},
		markCommitted(taskId) {
			state = 'committed'
			activeId = taskId
			if (cleanupEnabled) {
				for (const id of new Set([...displacedIds, taskId])) {
					persistence.removeRecovery(id)
					persistence.removeExtras(id)
					persistence.removeLaunchIdentity(id)
				}
			}
			displacedIds.clear()
		},
		enableCommitCleanup: () => {
			cleanupEnabled = true
		},
		disableCommitCleanup: () => {
			cleanupEnabled = false
		},
	}
}

export interface LauncherV3DraftController {
	lifecycle: LauncherV3DraftLifecycle
	persistence: LauncherV3DraftPersistence
}

export function useLauncherV3DraftController({
	initialDraftId,
	initialUploadBound = false,
	persistence,
}: {
	initialDraftId?: string
	initialUploadBound?: boolean
	persistence: LauncherV3DraftPersistence
}): LauncherV3DraftController {
	const [controller] = useState<LauncherV3DraftController>(() => ({
		lifecycle: createLauncherV3DraftLifecycle({
			initialId: initialDraftId,
			initialUploadBound,
			initialLaunchIdentity: initialDraftId
				? (persistence.readLaunchIdentity(initialDraftId) ?? undefined)
				: undefined,
			persistence,
		}),
		persistence,
	}))
	return controller
}
