import { describe, expect, test } from 'vitest'

import { onProjectsV2Flag, POSTHOG_INIT_CONFIG, resolveProjectsV2Flag } from '@/integrations/posthog/posthog'

describe('PostHog adapter configuration', () => {
	test('allows named events and flags without broad browser capture', () => {
		expect(POSTHOG_INIT_CONFIG).toMatchObject({
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			disable_session_recording: true,
			disable_surveys: true,
			disable_web_experiments: true,
			disable_external_dependency_loading: true,
		})
		expect(POSTHOG_INIT_CONFIG).not.toHaveProperty('advanced_disable_feature_flags', true)
		expect(POSTHOG_INIT_CONFIG).not.toHaveProperty('disable_feature_flags', true)
	})
})

describe('Projects V2 flag', () => {
	test.each([
		['control', 'v1'],
		['test', 'v2'],
	] as const)('maps PostHog variant %s to %s', (value, expected) => {
		expect(resolveProjectsV2Flag(value)).toBe(expected)
	})

	test.each([undefined, true, false, '', 'v1', 'v2', 'Control', 'variant-b'] as const)(
		'leaves %s unassigned',
		(value) => {
			expect(resolveProjectsV2Flag(value)).toBeUndefined()
		},
	)

	test('never calls back when PostHog is not configured', () => {
		let calls = 0
		const unsubscribe = onProjectsV2Flag('user-a', () => {
			calls += 1
		})
		unsubscribe()
		expect(calls).toBe(0)
	})
})
