import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { SyncContext } from '@/components/providers/SyncContext'
import type { SyncContextValue } from '@/components/providers/SyncProvider'
import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'

import { TaskArtifactMarkdownElement } from './TaskArtifactInline'
import { TaskArtifactViewer } from './TaskArtifactViewer'

vi.mock('@/hooks/useTaskArtifactUrl', () => ({ useTaskArtifactUrl: vi.fn() }))

beforeEach(() => {
	vi.mocked(useTaskArtifactUrl).mockReset()
	vi.mocked(useTaskArtifactUrl).mockReturnValue({
		artifact: undefined,
		url: undefined,
		error: null,
		isLoading: false,
	})
})

test.each(['preview.html', 'image.png'])('shared inline references display %s without authenticated lookup', (file) => {
	const path = `.humanlayer/tasks/shared-demo/${file}`
	render(<TaskArtifactMarkdownElement path={path} />)

	expect(screen.getByText(path).tagName).toBe('CODE')
	expect(useTaskArtifactUrl).not.toHaveBeenCalled()
})

test.each(['code', 'filePath'] as const)(
	'shared artifact blocks display the %s path without authenticated lookup',
	(prop) => {
		const path = '.humanlayer/tasks/shared-demo/preview.html'
		render(<TaskArtifactViewer {...{ [prop]: path }} />)

		expect(screen.getByText(path).tagName).toBe('CODE')
		expect(useTaskArtifactUrl).not.toHaveBeenCalled()
	},
)

test('authenticated markdown references still resolve task artifacts', () => {
	const sync = {} as SyncContextValue
	render(
		<SyncContext value={sync}>
			<TaskArtifactMarkdownElement path=".humanlayer/tasks/shared-demo/preview.html" />
			<TaskArtifactViewer code=".humanlayer/tasks/shared-demo/image.png" />
		</SyncContext>,
	)

	expect(useTaskArtifactUrl).toHaveBeenCalledWith({ taskSlug: 'shared-demo', fileName: 'preview.html' })
	expect(useTaskArtifactUrl).toHaveBeenCalledWith({ taskSlug: 'shared-demo', fileName: 'image.png' })
})
