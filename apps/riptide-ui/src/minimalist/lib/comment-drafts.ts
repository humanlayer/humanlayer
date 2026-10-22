import { draftSessionStorageKeys } from '@humanlayer/ui/lib/draft-session-storage-keys'
import { useState } from 'react'

/**
 * Comment text lives under the standard UI's sessionStorage keys (`draftSessionStorageKeys`, read through
 * `useDraftField`), so a draft follows you between the two interfaces. These helpers keep the rest a
 * minimalist box needs to reopen where it was: the words a new document comment is about, and which
 * diff lines have a comment half written.
 */

function read(key: string): string | null {
	try {
		return sessionStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string | null) {
	try {
		if (value === null) sessionStorage.removeItem(key)
		else sessionStorage.setItem(key, value)
	} catch {
		// Without storage a draft lasts as long as the page.
	}
}

/** Whether `useDraftField` holds text under `key`. Read once, to reopen a box that has a draft. */
export function hasDraft(key: string): boolean {
	return Boolean(read(key))
}

/**
 * A value kept in sessionStorage under `key`, read once when the component mounts. For the target
 * of a draft, which only changes when you open or close the box, so nothing else needs to hear of it.
 */
export function useStoredTarget<T>(key: string): [T | null, (next: T | null) => void] {
	const [value, setValue] = useState<T | null>(() => {
		const stored = read(key)
		if (!stored) return null
		try {
			return JSON.parse(stored) as T
		} catch {
			return null
		}
	})
	return [
		value,
		(next) => {
			write(key, next === null ? null : JSON.stringify(next))
			setValue(next)
		},
	]
}

/** Where an unsent comment on a document sits. Its text is under `draftSessionStorageKeys.newComment`. */
export const documentDraftTargetKey = (artifactId: string) => `minimalist:comment:new-target:${artifactId}`

export type DiffLinePoint = { side: 'old' | 'new'; line: number }

/** The draft key for a comment on one diff line: the standard key, as a one-line range. */
export function diffLineDraftKey(file: { taskId: string; repoId: string; path: string }, point: DiffLinePoint) {
	return draftSessionStorageKeys.diffCommentRoot({ ...file, start: point, end: point })
}

/** The lines of one file with a comment half written, so their boxes open again after a reload. */
export function draftedDiffLines(file: { taskId: string; repoId: string; path: string }): DiffLinePoint[] {
	// Each part is URL-encoded, so the only bare colons separate parts; the last two are the range ends.
	const prefix = `${diffLineDraftKey(file, { side: 'new', line: 0 }).split(':').slice(0, -2).join(':')}:`
	const points: DiffLinePoint[] = []
	try {
		for (let index = 0; index < sessionStorage.length; index++) {
			const key = sessionStorage.key(index)
			if (!key?.startsWith(prefix)) continue
			const ends = key.slice(prefix.length).split(':').map(decodeURIComponent)
			if (ends.length !== 2) continue
			const [startSide, startLine] = ends[0]?.split(':') ?? []
			const [endSide, endLine] = ends[1]?.split(':') ?? []
			// The standard UI can comment on a range; this one opens single lines only.
			if (startSide !== endSide || startLine !== endLine) continue
			if (startSide !== 'old' && startSide !== 'new') continue
			const line = Number(startLine)
			if (Number.isInteger(line)) points.push({ side: startSide, line })
		}
	} catch {
		// No storage, no saved drafts.
	}
	return points
}
