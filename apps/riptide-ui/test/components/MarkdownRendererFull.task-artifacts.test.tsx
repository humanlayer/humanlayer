import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render as renderWithProviders, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TaskArtifactReference } from '@/lib/task-artifact-path'

vi.mock('@/hooks/useTaskArtifactUrl', () => ({
	useTaskArtifactUrl: ({ fileName, taskSlug }: TaskArtifactReference) => {
		if (fileName.startsWith('missing'))
			return { artifact: undefined, url: undefined, error: null, isLoading: false }
		const isImage = fileName.endsWith('.png')
		return {
			artifact: { id: `artifact-${fileName}`, task_id: taskSlug === 'other-task' ? 'task-2' : 'task-1' },
			url: isImage ? `https://s3.test/${encodeURIComponent(fileName)}` : undefined,
			error: null,
			isLoading: false,
		}
	},
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	Link: ({
		children,
		params,
		search,
		...props
	}: {
		children: ReactNode
		params: { taskId: string }
		search: { artifactId: string }
	}) => (
		<a {...props} href={`/tasks/${params.taskId}?artifactId=${search.artifactId}`}>
			{children}
		</a>
	),
}))

import MarkdownRendererFull from '@/components/MarkdownRendererFull'
import { SyncContext } from '@/components/providers/SyncContext'
import type { SyncContextValue } from '@/components/providers/SyncProvider'
import { SessionDetailContext } from '@/components/session-detail/session-detail-context'

const AUTHENTICATED_SYNC = {} as SyncContextValue

function render(children: ReactNode) {
	return renderWithProviders(<SyncContext value={AUTHENTICATED_SYNC}>{children}</SyncContext>)
}

const SESSION_IN_TASK_1 = {
	session: { task_id: 'task-1' },
	artifactPanel: { handleArtifactClick: vi.fn() },
}

function renderInSession(content: string) {
	return render(
		<SessionDetailContext value={SESSION_IN_TASK_1 as never}>
			<MarkdownRendererFull content={content} preserveSingleLineBreaks preserveXmlTags artifactMentions />
		</SessionDetailContext>,
	)
}

afterEach(cleanup)

describe('MarkdownRendererFull task artifacts', () => {
	test.each([
		'/home/me/repo/.humanlayer/tasks/slug/shot.png',
		'.humanlayer/tasks/slug/shot.png',
		'~/.humanlayer/riptide/artifacts/task-1/shot.png',
	])('renders a markdown image at %j from its artifact URL', async (path) => {
		render(<MarkdownRendererFull content={`Here it is:\n\n![the login page](${path})`} preserveXmlTags />)

		const image = await screen.findByRole('img', { name: 'the login page' })
		expect(image).toHaveAttribute('src', 'https://s3.test/shot.png')
		expect(document.body).not.toHaveTextContent('Image blocked')
	})

	test('leaves remote markdown images alone', async () => {
		render(<MarkdownRendererFull content={'![badge](https://example.test/badge.png)'} />)

		const image = await screen.findByRole('img', { name: 'badge' })
		expect(image).toHaveAttribute('src', 'https://example.test/badge.png')
		expect(image).not.toHaveAttribute('node')
	})

	test.each(['/tmp/shots/bell-opened-doc.png', './shots/bell-opened-doc.png', '~/shots/bell-opened-doc.png'])(
		'shows an image saved on the host at %j as a chip instead of a broken image',
		async (path) => {
			render(<MarkdownRendererFull content={`Here it is:\n\n![bell](${path})`} preserveXmlTags />)

			const chip = await screen.findByTestId('host-image-chip')
			expect(chip).toHaveTextContent('bell-opened-doc.png')
			expect(chip.title).toContain(`${path} is on the host`)
			expect(screen.queryByRole('img')).not.toBeInTheDocument()
			expect(document.body).not.toHaveTextContent('Image blocked')
		},
	)

	test('renders a mentioned screenshot in a user message as an image', async () => {
		const fileName = 'Screenshot 2026-10-04 at 15.29.14.png'
		render(
			<MarkdownRendererFull
				content={`images are not shown\n\n@.humanlayer/tasks/slug/${fileName}`}
				preserveSingleLineBreaks
				preserveXmlTags
				artifactMentions
			/>,
		)

		const image = await screen.findByRole('img', { name: fileName })
		expect(image).toHaveAttribute('src', `https://s3.test/${encodeURIComponent(fileName)}`)
		expect(document.body).not.toHaveTextContent('@.humanlayer')
	})

	test('opens a mentioned document of the same task in the artifact panel', async () => {
		renderInSession('you can check @.humanlayer/tasks/this-task/slice-2-plan.md\nyes')

		const chip = await screen.findByRole('button', { name: 'Open slice-2-plan.md' })
		expect(chip).toHaveAttribute('title', '.humanlayer/tasks/this-task/slice-2-plan.md')
		fireEvent.click(chip)
		expect(SESSION_IN_TASK_1.artifactPanel.handleArtifactClick).toHaveBeenCalledWith('artifact-slice-2-plan.md')
		expect(document.body).toHaveTextContent('you can check')
		expect(document.body).toHaveTextContent('yes')
	})

	test('links a mentioned document of another task to that task', async () => {
		renderInSession('see @.humanlayer/tasks/other-task/design-notes.md')

		expect(await screen.findByRole('link', { name: 'Open design-notes.md' })).toHaveAttribute(
			'href',
			'/tasks/task-2?artifactId=artifact-design-notes.md',
		)
	})

	test('shows a mention that does not resolve as an inert chip', async () => {
		renderInSession('see @.humanlayer/tasks/this-task/missing-file.md')

		const chip = await screen.findByTestId('task-artifact-chip')
		expect(chip.tagName).toBe('SPAN')
		expect(chip).toHaveAttribute(
			'title',
			"Could not find .humanlayer/tasks/this-task/missing-file.md in the task's artifacts",
		)
	})

	test('keeps mentions as text unless requested', async () => {
		render(<MarkdownRendererFull content={'see @.humanlayer/tasks/slug/plan.md'} />)

		expect(await screen.findByText(/@\.humanlayer\/tasks\/slug\/plan\.md/)).toBeInTheDocument()
		expect(screen.queryByTestId('task-artifact-chip')).not.toBeInTheDocument()
	})
})
