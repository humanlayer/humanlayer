import { afterEach, describe, expect, test } from 'vitest'

import { useSettingsStore } from '../settingsStore'

afterEach(() => {
	useSettingsStore.getState().applyIntegrationCapabilities(null)
})

describe('settingsStore integration capabilities', () => {
	test('counts every integration as set up before the server answers', () => {
		const { jiraConfigured, linearConfigured, githubConfigured } = useSettingsStore.getState()
		expect({ jiraConfigured, linearConfigured, githubConfigured }).toEqual({
			jiraConfigured: true,
			linearConfigured: true,
			githubConfigured: true,
		})
	})

	test('takes each flag from the server answer', () => {
		useSettingsStore.getState().applyIntegrationCapabilities({ jira: false, linear: true, github: false })
		const state = useSettingsStore.getState()
		expect(state.jiraConfigured).toBe(false)
		expect(state.linearConfigured).toBe(true)
		expect(state.githubConfigured).toBe(false)
	})

	test('treats a failed request (older API) as every integration set up', () => {
		useSettingsStore.getState().applyIntegrationCapabilities({ jira: false, linear: false, github: false })
		useSettingsStore.getState().applyIntegrationCapabilities(null)
		const state = useSettingsStore.getState()
		expect([state.jiraConfigured, state.linearConfigured, state.githubConfigured]).toEqual([true, true, true])
	})

	test('keeps the flags out of storage so each session asks again', () => {
		const partialize = useSettingsStore.persist.getOptions().partialize
		const persisted = partialize?.(useSettingsStore.getState()) as Record<string, unknown>
		expect(persisted).not.toHaveProperty('jiraConfigured')
		expect(persisted).not.toHaveProperty('linearConfigured')
		expect(persisted).not.toHaveProperty('githubConfigured')
	})
})
