import { describe, expect, it } from 'vitest'

import { createStackRoutes } from '../lib/routes'
import { createStackIdentity, sanitizeStackId } from '../lib/stack-id'

describe.skipIf(Boolean(process.env.CI))('stack identity', () => {
	it('creates route, Docker, Tauri, and display-safe forms', () => {
		expect(createStackIdentity('Dex/Feature: A Great Thing!')).toEqual({
			id: 'dex-feature-a-great-thing',
			displayName: 'dex feature a great thing',
			dockerName: 'devstk-dex-feature-a-great-thing',
			tauriSuffix: 'dex_feature_a_great_thing',
		})
	})

	it('bounds route labels and rejects empty identifiers', () => {
		expect(sanitizeStackId('a'.repeat(100))).toHaveLength(63)
		expect(() => sanitizeStackId('!!!')).toThrow('does not contain any route-safe characters')
	})
})

describe.skipIf(Boolean(process.env.CI))('stack routes', () => {
	it('renders every service-first localhost route', () => {
		expect(createStackRoutes('my-branch')).toEqual({
			ui: 'https://app.my-branch.localhost',
			cloud: 'https://cloud.my-branch.localhost',
			api: 'https://api.my-branch.localhost',
			sync: 'https://sync.my-branch.localhost',
			docs: 'https://docs.my-branch.localhost',
			adminApi: 'https://admin-api.my-branch.localhost',
			adminUi: 'https://admin-ui.my-branch.localhost',
			s3: 'https://s3.my-branch.localhost',
		})
	})
})
