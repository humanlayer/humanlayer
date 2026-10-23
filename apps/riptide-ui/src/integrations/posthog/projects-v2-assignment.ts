import type { ProjectsV2Variant } from '@humanlayer/db/zodschemas/projects-v2-variant'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { logger } from '@/lib/logger'

export interface ProjectsV2AssignmentDependencies {
	/** Calls back with the recognized group, or `undefined` when PostHog gave no usable value. */
	subscribe: (callback: (variant: ProjectsV2Variant | undefined) => void) => () => void
	/** Sends the group to the server, which keeps the first one saved and returns the saved row. */
	save: (variant: ProjectsV2Variant) => Promise<{ userSettings: { projectsV2Enabled: boolean } }>
	/** Turns Projects V2 on locally. Called only when the server says access is on. */
	enable: () => void
	/** Waits before each retry of a failed save. One attempt per entry, after the first. */
	retryDelaysMs?: readonly number[]
}

const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000] as const

/**
 * Saves the first recognized Projects V2 group for one user and organization.
 *
 * Mount one subscription per `${userId}:${organizationId}`: the server stores the group per
 * organization, so an organization switch must send it again. The server keeps the first group,
 * so repeated sends are safe; this still sends at most once per subscription once a save succeeds.
 * A failed save retries on a short schedule and on the next flag load. Unrecognized values never
 * send anything, so a PostHog failure leaves the member unassigned and on V1.
 */
export function subscribeToProjectsV2Assignment(dependencies: ProjectsV2AssignmentDependencies): () => void {
	const retryDelaysMs = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
	let active = true
	let state: 'idle' | 'saving' | 'saved' = 'idle'
	let failures = 0
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	const save = (variant: ProjectsV2Variant) => {
		if (!active || state !== 'idle') return
		state = 'saving'
		dependencies.save(variant).then(
			(result) => {
				if (!active) return
				state = 'saved'
				if (result.userSettings.projectsV2Enabled) dependencies.enable()
			},
			(error: unknown) => {
				if (!active) return
				state = 'idle'
				logger.warn('Failed to save Projects V2 experiment group', error)
				const delay = retryDelaysMs[failures]
				failures += 1
				if (delay === undefined) return
				clearTimeout(retryTimer)
				retryTimer = setTimeout(() => save(variant), delay)
			},
		)
	}

	const unsubscribe = dependencies.subscribe((variant) => {
		if (variant === undefined) return
		save(variant)
	})

	return () => {
		active = false
		clearTimeout(retryTimer)
		unsubscribe()
	}
}

/**
 * Turns Projects V2 on in the settings store, but only while the store still belongs to `scope`,
 * so a late response for an organization the member has left cannot change the new one.
 */
export function enableProjectsV2ForScope(scope: string): void {
	if (useSettingsStore.getState()._serverSettingsRequestedScope !== scope) return
	useSettingsStore.setState({ projectsV2Enabled: true })
}
