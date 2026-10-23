import { beforeEach, describe, expect, test } from 'vitest'

import { useArtifactViewerStore } from './artifactViewerStore'

describe('artifactViewerStore', () => {
	beforeEach(() => {
		useArtifactViewerStore.setState({ forceLegacyViewerByArtifactId: {} })
	})

	test('isolates temporary legacy overrides by artifact', () => {
		useArtifactViewerStore.getState().setForceLegacyViewer('artifact-1', true)
		useArtifactViewerStore.getState().setForceLegacyViewer('artifact-2', true)

		expect(useArtifactViewerStore.getState().forceLegacyViewerByArtifactId).toEqual({
			'artifact-1': true,
			'artifact-2': true,
		})

		useArtifactViewerStore.getState().setForceLegacyViewer('artifact-1', false)

		expect(useArtifactViewerStore.getState().forceLegacyViewerByArtifactId).toEqual({ 'artifact-2': true })
	})

	test('does not persist overrides to browser storage', () => {
		useArtifactViewerStore.getState().setForceLegacyViewer('artifact-1', true)

		expect('persist' in useArtifactViewerStore).toBe(false)
		expect(useArtifactViewerStore.getState().forceLegacyViewerByArtifactId).toEqual({ 'artifact-1': true })
	})
})
