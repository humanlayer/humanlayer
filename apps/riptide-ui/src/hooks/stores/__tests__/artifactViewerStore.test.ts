import { beforeEach, describe, expect, test } from 'vitest'

import { useArtifactViewerStore } from '../artifactViewerStore'
import { FOCUSED_AREAS } from '../focus-areas'
import { useFocusStore } from '../focusStore'

describe('artifactViewerStore focus ownership', () => {
	beforeEach(() => {
		localStorage.clear()
		document.body.replaceChildren()
		useFocusStore.setState({ focusedArea: 'MAIN' })
		useArtifactViewerStore.setState({
			selectedArtifactId: null,
			viewMode: 'rendered',
			versionSelectionByArtifact: {},
			isFullscreen: false,
			isFullscreenModalOpen: false,
			isSidebarViewerMounted: false,
			sidebarOutlinePreference: 'auto',
			forceLegacyViewerByArtifactId: {},
			readingFocusByArtifactId: {},
			foldsByArtifactId: {},
		})
	})

	test('publishes immutable artifact-scoped snapshots with growing revisions', () => {
		const first = {
			artifactId: 'artifact-1',
			scrollTop: 120,
			anchor: null,
			anchorViewportOffset: -20,
			keyboardFocused: false,
			writer: 'sidebar' as const,
		}
		useArtifactViewerStore.getState().publishReadingFocus(first)
		const firstRecord = useArtifactViewerStore.getState().readingFocusByArtifactId
		useArtifactViewerStore.getState().publishReadingFocus({ ...first, scrollTop: 180 })
		useArtifactViewerStore.getState().publishReadingFocus({ ...first, artifactId: 'artifact-2' })

		const records = useArtifactViewerStore.getState().readingFocusByArtifactId
		expect(records).not.toBe(firstRecord)
		expect(records['artifact-1']).toMatchObject({ scrollTop: 180, revision: 2 })
		expect(records['artifact-2']).toMatchObject({ scrollTop: 120, revision: 1 })
	})

	test('excludes reading snapshots from persisted viewer state', () => {
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1', { claimFocus: false })
		useArtifactViewerStore.getState().publishReadingFocus({
			artifactId: 'artifact-1',
			scrollTop: 120,
			anchor: null,
			anchorViewportOffset: 0,
			keyboardFocused: false,
			writer: 'sidebar',
		})

		const persisted = JSON.parse(localStorage.getItem('riptide-artifact-viewer') ?? '{}')
		expect(persisted.state).toEqual({
			selectedArtifactId: 'artifact-1',
			viewMode: 'rendered',
			versionSelectionByArtifact: {},
			sidebarOutlinePreference: 'auto',
		})
	})

	test('persists one outline preference across all sidebar artifacts', () => {
		useArtifactViewerStore.getState().setSidebarOutlinePreference('closed')

		const persisted = JSON.parse(localStorage.getItem('riptide-artifact-viewer') ?? '{}')
		expect(persisted.state.sidebarOutlinePreference).toBe('closed')
		expect(useArtifactViewerStore.getState().sidebarOutlinePreference).toBe('closed')
	})

	test.each([
		[true, 'auto'],
		[false, 'closed'],
	] as const)('migrates the old %s outline value to %s', async (isOpen, preference) => {
		const migrate = useArtifactViewerStore.persist.getOptions().migrate!

		const migrated = await migrate(
			{
				selectedArtifactId: null,
				viewMode: 'rendered',
				versionSelectionByArtifact: {},
				isSidebarOutlineOpen: isOpen,
			},
			2,
		)

		expect(migrated).toMatchObject({ sidebarOutlinePreference: preference })
	})

	test('replaces complete fold sets without changing other artifacts', () => {
		useArtifactViewerStore.getState().setArtifactFolds('artifact-1', new Set(['h1-one']))
		useArtifactViewerStore.getState().setArtifactFolds('artifact-2', new Set(['h2-two']))
		useArtifactViewerStore.getState().setArtifactFolds('artifact-1', new Set(['h1-next']))

		expect(useArtifactViewerStore.getState().foldsByArtifactId).toEqual({
			'artifact-1': new Set(['h1-next']),
			'artifact-2': new Set(['h2-two']),
		})
	})

	test('does not notify subscribers when a fold set is unchanged', () => {
		useArtifactViewerStore.getState().setArtifactFolds('artifact-1', new Set(['h1-one', 'h2-two']))
		const before = useArtifactViewerStore.getState().foldsByArtifactId
		let notifications = 0
		const unsubscribe = useArtifactViewerStore.subscribe(() => notifications++)

		useArtifactViewerStore.getState().setArtifactFolds('artifact-1', new Set(['h2-two', 'h1-one']))

		unsubscribe()
		expect(notifications).toBe(0)
		expect(useArtifactViewerStore.getState().foldsByArtifactId).toBe(before)
	})

	test('excludes folds from persisted viewer state', () => {
		useArtifactViewerStore.getState().setArtifactFolds('artifact-1', new Set(['h1-one']))

		const partialize = useArtifactViewerStore.persist.getOptions().partialize
		expect(partialize?.(useArtifactViewerStore.getState())).toEqual({
			selectedArtifactId: null,
			viewMode: 'rendered',
			versionSelectionByArtifact: {},
			sidebarOutlinePreference: 'auto',
		})
	})

	test('keeps version pairs isolated by artifact', () => {
		const store = useArtifactViewerStore.getState()
		store.setVersionSelection('artifact-1', { sourceId: 'version-1', destinationId: 'latest' })
		store.setVersionSelection('artifact-2', { sourceId: 'version-3', destinationId: 'version-2' })

		expect(useArtifactViewerStore.getState().versionSelectionByArtifact).toEqual({
			'artifact-1': { sourceId: 'version-1', destinationId: 'latest' },
			'artifact-2': { sourceId: 'version-3', destinationId: 'version-2' },
		})
	})

	test('an explicit artifact selection claims RIGHT_PANE', () => {
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1')

		expect(useArtifactViewerStore.getState().selectedArtifactId).toBe('artifact-1')
		expect(useFocusStore.getState().focusedArea).toBe('RIGHT_PANE')
	})

	test.each(['rendered', 'raw'] as const)('keeps %s when selecting another artifact', (viewMode) => {
		useArtifactViewerStore.setState({ selectedArtifactId: 'artifact-1', viewMode })

		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-2')

		expect(useArtifactViewerStore.getState().viewMode).toBe(viewMode)
	})

	test('returns to Rendered when selecting another artifact from Diff', () => {
		useArtifactViewerStore.setState({ selectedArtifactId: 'artifact-1', viewMode: 'diff' })

		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-2')

		expect(useArtifactViewerStore.getState().viewMode).toBe('rendered')
	})

	test('keeps Diff when selecting the current artifact again', () => {
		useArtifactViewerStore.setState({ selectedArtifactId: 'artifact-1', viewMode: 'diff' })

		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1')

		expect(useArtifactViewerStore.getState().viewMode).toBe('diff')
	})

	test('restoring a persisted artifact preserves MAIN ownership', () => {
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1', { claimFocus: false })

		expect(useArtifactViewerStore.getState().selectedArtifactId).toBe('artifact-1')
		expect(useFocusStore.getState().focusedArea).toBe('MAIN')
	})

	test('surface availability changes never revoke an explicit claim', () => {
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1')
		useArtifactViewerStore.getState().setSidebarViewerMounted(true)
		useArtifactViewerStore.getState().setSidebarViewerMounted(false)

		expect(useFocusStore.getState().focusedArea).toBe('RIGHT_PANE')
	})

	test('clearing the selected artifact returns ownership to MAIN', () => {
		const pane = document.createElement('div')
		pane.dataset.focusArea = FOCUSED_AREAS.RIGHT_PANE
		const button = document.createElement('button')
		pane.append(button)
		document.body.append(pane)
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1')
		button.focus()
		useArtifactViewerStore.getState().clearSelection()

		expect(useFocusStore.getState().focusedArea).toBe('MAIN')
		expect(document.activeElement).toBe(document.body)
	})

	test('clearing the viewer preserves RIGHT_PANE when the sidebar artifact list remains available', () => {
		useArtifactViewerStore.getState().setSidebarViewerMounted(true)
		useArtifactViewerStore.getState().setSelectedArtifactId('artifact-1')

		useArtifactViewerStore.getState().clearSelection()

		expect(useArtifactViewerStore.getState().selectedArtifactId).toBeNull()
		expect(useFocusStore.getState().focusedArea).toBe('RIGHT_PANE')
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

	test('keeps legacy overrides out of persisted state', () => {
		useArtifactViewerStore.getState().setForceLegacyViewer('artifact-1', true)

		const partialize = useArtifactViewerStore.persist.getOptions().partialize
		expect(partialize?.(useArtifactViewerStore.getState())).toEqual({
			selectedArtifactId: null,
			viewMode: 'rendered',
			versionSelectionByArtifact: {},
			sidebarOutlinePreference: 'auto',
		})
	})
})
