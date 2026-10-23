import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getArtifactCloudUrl, getArtifactSharingUrl, getOrgSettingsUrl } from './artifact-links'

describe('getArtifactSharingUrl', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_PUBLIC_CLOUD_ORIGIN', 'https://cloud.example.com')
		vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://app.example.com')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	test('targets the authenticated task and opens the artifact when public access is off', () => {
		expect(getArtifactSharingUrl('task-id', 'artifact-id', 'off', 'existing-key')).toBe(
			'https://app.example.com/tasks/task-id?artifactId=artifact-id',
		)
	})

	test('targets the app capability viewer when public viewing is on', () => {
		expect(getArtifactSharingUrl('task-id', 'artifact-id', 'view', 'share-key')).toBe(
			'https://app.example.com/shared/artifacts/artifact-id?key=share-key',
		)
	})

	test('waits for the server-owned key on first enablement', () => {
		expect(getArtifactSharingUrl('task-id', 'artifact-id', 'view', null)).toBeNull()
	})
})

describe('cloud links', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	test('point at the configured cloud origin', () => {
		vi.stubEnv('VITE_PUBLIC_CLOUD_ORIGIN', 'https://cloud.example.com')
		expect(getArtifactCloudUrl('artifact-id')).toBe('https://cloud.example.com/artifacts/artifact-id')
		expect(getOrgSettingsUrl()).toBe('https://cloud.example.com/settings')
	})

	test('are undefined in a build without a cloud origin', () => {
		vi.stubEnv('VITE_PUBLIC_CLOUD_ORIGIN', '')
		expect(getArtifactCloudUrl('artifact-id')).toBeUndefined()
		expect(getOrgSettingsUrl()).toBeUndefined()
	})
})
