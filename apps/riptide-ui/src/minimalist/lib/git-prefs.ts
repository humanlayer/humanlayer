import type { MergeMethod } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { useSyncExternalStore } from 'react'

/** Settings → Git. Stored on this device; each value shapes a prompt or a button, never git itself. */
export type GitPrefs = {
	branchPrefix: string
	draftPullRequests: boolean
	mergeMethod: MergeMethod | 'github'
	commitInstructions: string
	pullRequestInstructions: string
}

const KEY = 'hl-min-git'
const LEGACY_DRAFT_KEY = 'hl-min-pr-draft'
const DEFAULTS: GitPrefs = {
	branchPrefix: '',
	draftPullRequests: true,
	mergeMethod: 'github',
	commitInstructions: '',
	pullRequestInstructions: '',
}

const listeners = new Set<() => void>()
let cached: { raw: string | null; prefs: GitPrefs } | null = null

export function readGitPrefs(): GitPrefs {
	let raw: string | null = null
	try {
		raw = localStorage.getItem(KEY)
		if (raw === null && localStorage.getItem(LEGACY_DRAFT_KEY) === 'false')
			return { ...DEFAULTS, draftPullRequests: false }
	} catch {
		return DEFAULTS
	}
	if (cached?.raw === raw) return cached.prefs
	let prefs = DEFAULTS
	try {
		prefs = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GitPrefs>) } : DEFAULTS
	} catch {
		// A damaged value falls back to the defaults.
	}
	cached = { raw, prefs }
	return prefs
}

export function setGitPrefs(patch: Partial<GitPrefs>) {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...readGitPrefs(), ...patch }))
	} catch {
		// Storage is blocked; the change lasts until reload through the listeners below.
	}
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEY) listener()
	}
	window.addEventListener('storage', onStorage)
	return () => {
		listeners.delete(listener)
		window.removeEventListener('storage', onStorage)
	}
}

export function useGitPrefs(): GitPrefs {
	return useSyncExternalStore(subscribe, readGitPrefs, () => DEFAULTS)
}

/** `feature/` + `fix-login-a1b2` → `feature/fix-login-a1b2`. Spaces and stray slashes are cleaned up. */
export function branchName(prefix: string, slug: string): string {
	const clean = prefix.trim().replace(/\s+/g, '-').replace(/^\/+/, '')
	if (!clean) return slug
	return clean.endsWith('/') || clean.endsWith('-') ? `${clean}${slug}` : `${clean}/${slug}`
}
