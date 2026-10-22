import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

async function loadArtifactUrl() {
	vi.resetModules()
	return import('../../../../../src/agents/claudecode/hooks/artifact-url')
}

describe('getArtifactCloudUrl', () => {
	test('uses the cloud origin selected by the CLI at runtime', async () => {
		vi.stubEnv('RIPTIDE_CLOUD_ORIGIN', 'https://cloud.runtime.test')
		const { getArtifactCloudUrl } = await loadArtifactUrl()

		expect(getArtifactCloudUrl('artifact-id')).toBe('https://cloud.runtime.test/artifacts/artifact-id')
	})

	test('has no link when no cloud origin is configured', async () => {
		vi.stubEnv('RIPTIDE_CLOUD_ORIGIN', '')
		vi.stubEnv('RIPTIDE_DAEMON_CLOUD_ORIGIN', '')
		const { artifactLinkLine, artifactSyncedNote, getArtifactCloudUrl } = await loadArtifactUrl()

		expect(getArtifactCloudUrl('artifact-id')).toBeUndefined()
		expect(artifactSyncedNote(undefined)).toBe('Artifact synced to cloud.')
		expect(artifactLinkLine('plan.md', undefined)).toBe('- plan.md')
	})
})
