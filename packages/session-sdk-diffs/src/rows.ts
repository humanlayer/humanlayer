// The rows of a task's diff-files and diff-patches streams, as plain objects. @humanlayer/streams/diff
// holds the same rows as Effect Schema classes, with branded ids.

import { MAX_TASK_DIFF_BODY_BYTES } from '@humanlayer/streams/config'

// `@humanlayer/streams/config` renamed this to MAX_TASK_DIFF_BODY_BYTES; the plugins' patch-based
// diffs still measure against the same cap, so keep exposing it under the patch name here.
export const MAX_TASK_DIFF_PATCH_BYTES = MAX_TASK_DIFF_BODY_BYTES

export interface TaskDiffFileRow {
	/** `${taskId}:${repoId}:${path}`, also the stream key. The web app splits it on ":". */
	id: string
	taskId: string
	repoId: string
	repoDisplayName?: string
	sessionId: string
	path: string
	prevPath?: string
	changeType: 'modified' | 'added' | 'deleted' | 'renamed'
	additions: number
	deletions: number
	binary: boolean
	generated: boolean
	patchHash?: string
	patchByteLength?: number
	/** Set when the file changed but its patch was not published. */
	patchOmittedReason?: 'too_large'
	updatedAt: string
}

/** Keyed by the patch's sha256. */
export interface TaskDiffPatchRow {
	/** = patchHash */
	id: string
	taskId: string
	repoId: string
	sessionId: string
	patchHash: string
	patch: string
	byteLength: number
	updatedAt: string
}

export function diffFileRowId(taskId: string, repoId: string, path: string): string {
	return `${taskId}:${repoId}:${path}`
}

/** The patch ships JSON-escaped, so the escaped form is what must fit under the cap. */
export function patchFits(patch: string, maxBytes: number = MAX_TASK_DIFF_PATCH_BYTES): boolean {
	return Buffer.byteLength(JSON.stringify(patch)) <= maxBytes
}
