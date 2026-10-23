import '@testing-library/jest-dom/vitest'
import { commentAuthorColumns } from '@humanlayer/db/artifact-comment-author'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'

const harness = vi.hoisted(() => ({
	permission: 'comment' as 'view' | 'comment',
	commentRows: [] as unknown[],
	artifact: {} as Record<string, unknown>,
}))

const markdownArtifact = {
	id: 'artifact-1',
	file_name: 'plan.md',
	content: '# Plan\n\nTarget paragraph.\n',
	storage_type: 'postgres',
}

vi.mock('@workos-inc/authkit-react', () => ({ useAuth: () => ({ isLoading: false, user: null }) }))
vi.mock('@/hooks/use-browser-auth', () => ({
	useBrowserAuth: () => ({ signIn: vi.fn(), switchOrganization: vi.fn() }),
}))
vi.mock('@/hooks/useDeepLinkHandoff', () => ({ useDeepLinkHandoff: () => {} }))
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn(),
	useLocation: () => ({ pathname: '/shared/artifacts/artifact-1', search: {} }),
	useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) => select({}),
	useSearch: ({ select }: { select: (search: Record<string, unknown>) => unknown }) => select({ key: 'share' }),
	useRouter: () => ({ buildLocation: () => ({ href: '/shared/artifacts/artifact-1?key=share' }) }),
}))
vi.mock('@/orpc/client', () => ({
	useRiptideApi: () => ({
		client: { public: { artifacts: {} } },
		queryClient: {
			public: {
				artifacts: {
					commentAuthors: { queryOptions: () => ({ queryKey: ['comment-authors'] }) },
					downloadUrl: { queryOptions: () => ({ queryKey: ['download-url'] }) },
				},
			},
		},
	}),
}))
vi.mock('@tanstack/react-query', () => ({
	useQuery: ({ queryKey }: { queryKey: string[] }) => {
		const refetch = async () => undefined
		if (queryKey[0] === 'shared-artifact-resolution') {
			return {
				isLoading: false,
				isError: false,
				data: { kind: 'public', permission: harness.permission },
			}
		}
		if (queryKey[0] === 'download-url') {
			return { isLoading: false, isError: false, data: { downloadUrl: 'https://s3.example/share-check.html' } }
		}
		return { data: { authors: [] }, refetch }
	},
}))
vi.mock('@/hooks/shared-artifact/useSharedArtifactCollection', () => ({
	useSharedArtifactCollection: () => ({ kind: 'artifacts' }),
}))
vi.mock('@/hooks/shared-artifact/useSharedArtifactCommentsCollection', () => ({
	useSharedArtifactCommentsCollection: () => ({ kind: 'comments', utils: { awaitTxId: vi.fn() } }),
}))
vi.mock('@tanstack/react-db', () => ({
	eq: vi.fn(),
	useLiveQuery: (_query: unknown, [collection]: [{ kind: string }]) =>
		collection.kind === 'artifacts'
			? {
					data: [harness.artifact],
					isLoading: false,
					isError: false,
					isReady: true,
				}
			: { data: harness.commentRows, isLoading: false, isError: false, isReady: true },
}))

import { SharedArtifactProviders } from './SharedArtifactProviders'
import { SharedArtifactRoute } from './SharedArtifactRoute'

const paragraph = {
	blockType: 'paragraph',
	blockText: 'Target paragraph.',
	previousBlockText: 'Plan',
	nextBlockText: null,
}

function renderRoute() {
	return render(
		<SharedArtifactProviders>
			<SharedArtifactRoute artifactId="artifact-1" shareKey="share" />
		</SharedArtifactProviders>,
	)
}

describe('SharedArtifactRoute', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		// A wide viewer keeps the comment rail open; jsdom measures every element as zero wide.
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1400, 800))
		useCommandPaletteStore.setState({ actions: new Map() })
		harness.artifact = markdownArtifact
		harness.commentRows = [
			{
				id: 'guest-comment',
				artifact_id: 'artifact-1',
				...commentAuthorColumns({ kind: 'guest', anonymousAuthorId: 'guest-1', guestName: 'Bob Zungle' }),
				reply_to_comment_id: null,
				created_at: 1n,
				updated_at: 1n,
				content_text: 'Guest feedback',
				content_json: null,
				kind: 'comment',
				is_resolved: false,
				is_deleted: false,
				created_by_agent: false,
				anchor_json: {
					v: 2,
					scope: 'block',
					selectedText: 'Target paragraph.',
					start: { ...paragraph, offset: 0 },
					end: { ...paragraph, offset: 'Target paragraph.'.length },
				},
			},
		]
	})

	afterEach(() => {
		cleanup()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test('comment links render the shared viewer with guest comments and no agent delivery', async () => {
		harness.permission = 'comment'
		renderRoute()

		await waitFor(() => expect(screen.getByText('Guest feedback')).toBeInTheDocument())
		expect(screen.getByText('Bob Zungle')).toBeInTheDocument()
		expect(screen.getByText('Unverified')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
		for (const label of ['Resolve', 'Edit', 'Delete']) {
			expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
		}
		expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
		expect(useCommandPaletteStore.getState().actions.has('send-all-artifact-comments-to-agent')).toBe(false)
		expect(screen.queryByRole('tab', { name: 'DIFF' })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
		expect(screen.getByRole('textbox')).toBeInTheDocument()
	})

	test('view links render the document without a comment rail', async () => {
		harness.permission = 'view'
		renderRoute()

		await waitFor(() => expect(screen.getByText('Target paragraph.')).toBeInTheDocument())
		expect(screen.getByText('View only')).toBeInTheDocument()
		expect(screen.queryByText('Guest feedback')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Toggle comment rail' })).not.toBeInTheDocument()
		expect(document.querySelector('.artifact-viewer-v2-review-rail')).toBeNull()
	})

	test.each(['view', 'comment'] as const)(
		'%s links render embedded artifact paths without authenticated sync',
		async (permission) => {
			harness.permission = permission
			const path = '.humanlayer/tasks/shared-demo/preview.html'
			harness.artifact = {
				...markdownArtifact,
				content: `${markdownArtifact.content}\n\`\`\`task-artifact\n${path}\n\`\`\`\n`,
			}
			renderRoute()

			await waitFor(() => expect(screen.getByText(path)).toBeInTheDocument())
			expect(screen.getByText('Target paragraph.')).toBeInTheDocument()
			expect(document.querySelector('iframe')).toBeNull()
		},
	)

	test('S3 artifacts render from the presigned URL as view only, even on comment links', async () => {
		harness.permission = 'comment'
		harness.artifact = { id: 'artifact-1', file_name: 'share-check.html', content: '', storage_type: 's3' }
		renderRoute()

		const frame = await screen.findByTitle('share-check.html')
		expect(frame).toHaveAttribute('src', 'https://s3.example/share-check.html')
		expect(screen.getByText('View only')).toBeInTheDocument()
		expect(document.querySelector('.artifact-viewer-v2')).toBeNull()
	})
})
