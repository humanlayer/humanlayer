import { beforeEach, describe, expect, test } from 'vitest'

import { useArtifactListFocusStore } from '../artifactListFocusStore'

const artifactIds = ['artifact-a', 'artifact-b', 'artifact-c']

describe('artifactListFocusStore', () => {
	beforeEach(() => {
		useArtifactListFocusStore.setState({
			focusedArtifactId: null,
			focusedArtifactIndex: null,
			focusSource: null,
		})
	})

	test('starts unfocused and is never persisted', () => {
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBeNull()
		expect(useArtifactListFocusStore.getState().focusedArtifactIndex).toBeNull()
		expect(useArtifactListFocusStore.getState().focusSource).toBeNull()
		expect('persist' in useArtifactListFocusStore).toBe(false)
	})

	test('pointer focus records the row id, index, and source', () => {
		useArtifactListFocusStore.getState().setFocusedArtifact('artifact-b', 1, 'pointer')

		expect(useArtifactListFocusStore.getState()).toMatchObject({
			focusedArtifactId: 'artifact-b',
			focusedArtifactIndex: 1,
			focusSource: 'pointer',
		})
	})

	test('first keyboard movement lands on the first row', () => {
		useArtifactListFocusStore.getState().focusNext(artifactIds)

		expect(useArtifactListFocusStore.getState()).toMatchObject({
			focusedArtifactId: 'artifact-a',
			focusedArtifactIndex: 0,
			focusSource: 'keyboard',
		})
	})

	test('next and previous move through the list and clamp at both ends', () => {
		useArtifactListFocusStore.getState().setFocusedArtifact('artifact-b', 1, 'keyboard')

		useArtifactListFocusStore.getState().focusNext(artifactIds)
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBe('artifact-c')
		useArtifactListFocusStore.getState().focusNext(artifactIds)
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBe('artifact-c')

		useArtifactListFocusStore.getState().focusPrevious(artifactIds)
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBe('artifact-b')
		useArtifactListFocusStore.getState().focusPrevious(artifactIds)
		useArtifactListFocusStore.getState().focusPrevious(artifactIds)
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBe('artifact-a')
	})

	test('reconciliation updates the index when the focused row moves', () => {
		useArtifactListFocusStore.getState().setFocusedArtifact('artifact-b', 1, 'keyboard')
		useArtifactListFocusStore.getState().reconcileArtifactIds(['artifact-b', 'artifact-a'])

		expect(useArtifactListFocusStore.getState()).toMatchObject({
			focusedArtifactId: 'artifact-b',
			focusedArtifactIndex: 0,
			focusSource: 'keyboard',
		})
	})

	test('reconciliation clears a row removed from the artifact set', () => {
		useArtifactListFocusStore.getState().setFocusedArtifact('artifact-b', 1, 'keyboard')
		useArtifactListFocusStore.getState().reconcileArtifactIds(['artifact-a', 'artifact-c'])

		expect(useArtifactListFocusStore.getState()).toMatchObject({
			focusedArtifactId: null,
			focusedArtifactIndex: null,
			focusSource: null,
		})
	})

	test('empty-list movement is a no-op and clearFocus resets the cursor', () => {
		useArtifactListFocusStore.getState().setFocusedArtifact('artifact-a', 0, 'keyboard')
		useArtifactListFocusStore.getState().focusNext([])
		expect(useArtifactListFocusStore.getState().focusedArtifactId).toBe('artifact-a')

		useArtifactListFocusStore.getState().clearFocus()
		expect(useArtifactListFocusStore.getState()).toMatchObject({
			focusedArtifactId: null,
			focusedArtifactIndex: null,
			focusSource: null,
		})
	})
})
