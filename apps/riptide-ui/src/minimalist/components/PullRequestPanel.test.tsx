import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PullRequestDetail } from './PullRequestPanel'

vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: {} }) }))
vi.mock('@/hooks/session-detail/usePrStatusStream', () => ({
	usePrStatusStream: () => ({ pullRequest: null, checks: [] }),
}))
vi.mock('@/minimalist/lib/use-action', () => ({ useAction: () => ({ pending: false, run: vi.fn() }) }))
vi.mock('@/minimalist/lib/send', () => ({
	useAskAgent: () => ({ pending: false, ask: vi.fn() }),
	askToast: vi.fn(),
}))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))

afterEach(cleanup)

type Props = Parameters<typeof PullRequestDetail>[0]

const pullRequest = {
	number: 42,
	url: 'https://github.com/acme/app/pull/42',
	title: 'Add the thing',
	state: 'open',
	isDraft: false,
	baseRef: 'main',
	headRef: 'feature',
	reviewDecision: null,
	changesRequestedReviews: [],
	merge: null,
} as unknown as Props['pullRequest']

describe('PullRequestDetail', () => {
	it('copies the pull request link from beside the link out', async () => {
		const writeText = vi.fn(async () => {})
		Object.assign(navigator, { clipboard: { writeText } })
		render(
			<PullRequestDetail
				taskId="task"
				sessionId={null}
				branch={{ repoFullName: 'acme/app', branch: 'feature', pullRequest } as unknown as Props['branch']}
				pullRequest={pullRequest}
			/>,
		)
		expect(screen.getByRole('link', { name: /acme\/app #42/ }).getAttribute('href')).toBe(pullRequest.url)
		fireEvent.click(screen.getByRole('button', { name: 'Copy pull request link' }))
		await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://github.com/acme/app/pull/42'))
	})
})
