import { useCallback, useSyncExternalStore } from 'react'

import { type CommentVisibility, isCommentVisibility } from './comment-visibility'

/**
 * Session-scoped, per-artifact memory of the rail's completion filter. Kept
 * apart from draft keys and the desktop local-storage viewer store: the
 * identity is the artifact alone, so content/version updates and presentation
 * changes keep the same preference.
 */
export const commentVisibilitySessionStorageKeys = {
	visibility: (artifactId: string) => `artifact-comment-visibility:${artifactId}`,
}

const DEFAULT_VISIBILITY: CommentVisibility = 'open'

// Same-page fallback that holds a selection only while session storage
// rejects writes, plus the channel that keeps sidebar/fullscreen rails in
// agreement.
const memory = new Map<string, CommentVisibility>()
const listeners = new Set<() => void>()

function sessionStorageOrNull(): Storage | null {
	try {
		return typeof window === 'undefined' ? null : window.sessionStorage
	} catch {
		return null
	}
}

/** The artifact's remembered filter: in-page value, then session storage, then Open. */
export function readCommentVisibilityPreference(artifactId: string): CommentVisibility {
	const key = commentVisibilitySessionStorageKeys.visibility(artifactId)
	const remembered = memory.get(key)
	if (remembered) return remembered
	try {
		const stored = sessionStorageOrNull()?.getItem(key)
		if (isCommentVisibility(stored)) return stored
	} catch {
		// Blocked storage reads fall through to the default.
	}
	return DEFAULT_VISIBILITY
}

/** Remember an explicit selection. Storage failures keep the in-page value. */
export function writeCommentVisibilityPreference(artifactId: string, visibility: CommentVisibility): void {
	const key = commentVisibilitySessionStorageKeys.visibility(artifactId)
	try {
		const storage = sessionStorageOrNull()
		if (!storage) throw new Error('Session storage unavailable')
		storage.setItem(key, visibility)
		memory.delete(key)
	} catch {
		// Quota or privacy-mode failures keep the selection usable in memory.
		memory.set(key, visibility)
	}
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * The rail's completion filter for `artifactId`. Reading never seeds storage;
 * only the returned setter writes. Switching artifacts reads the new key in the
 * same render, so the previous artifact's filter never shows.
 */
export function useCommentVisibilityPreference(
	artifactId: string,
): [CommentVisibility, (visibility: CommentVisibility) => void] {
	const visibility = useSyncExternalStore(
		subscribe,
		() => readCommentVisibilityPreference(artifactId),
		() => DEFAULT_VISIBILITY,
	)
	const setVisibility = useCallback(
		(next: CommentVisibility) => writeCommentVisibilityPreference(artifactId, next),
		[artifactId],
	)
	return [visibility, setVisibility]
}
