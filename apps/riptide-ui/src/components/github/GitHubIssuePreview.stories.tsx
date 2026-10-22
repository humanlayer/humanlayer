import type { Meta, StoryObj } from '@storybook/react-vite'

import { GitHubIssuePreview } from '@/components/GitHubIssuePreview'

const preview = {
	repository: { fullName: 'acme/web-platform' },
	issueNumber: 482,
	title: 'Preserve repository identity when importing issue URLs',
	url: 'https://github.com/acme/web-platform/issues/482',
	state: 'open' as const,
	body: 'Pasting a complete GitHub issue URL should **select the installed repository** and show an authoritative preview.\n\n## Acceptance criteria\n\n- Preserve stable repository identity\n- Render issue Markdown\n- Fetch every comment page',
	labels: ['integration', 'desktop'],
	assignees: ['octocat'],
	authorLogin: 'mona',
	createdAt: '2026-07-17T12:00:00Z',
	updatedAt: '2026-07-17T13:00:00Z',
	comments: [
		{
			id: '9001',
			url: 'https://github.com/acme/web-platform/issues/482#issuecomment-9001',
			body: 'Confirmed on desktop. The `repositoryId` remains stable.',
			authorLogin: 'octocat',
			createdAt: '2026-07-17T12:30:00Z',
			updatedAt: '2026-07-17T12:30:00Z',
		},
		{
			id: '9002',
			url: 'https://github.com/acme/web-platform/issues/482#issuecomment-9002',
			body: 'Mobile verification:\n\n- No horizontal overflow\n- Picker remains usable',
			authorLogin: 'mona',
			createdAt: '2026-07-17T13:00:00Z',
			updatedAt: '2026-07-17T13:00:00Z',
		},
	],
}

const meta = {
	title: 'Components/GitHub/IssuePreview',
	component: GitHubIssuePreview,
	parameters: { layout: 'centered' },
	decorators: [(Story) => <div className="w-[min(38rem,calc(100vw-2rem))]"><Story /></div>],
	args: { preview },
} satisfies Meta<typeof GitHubIssuePreview>

export default meta
type Story = StoryObj<typeof meta>

export const OpenIssue: Story = {}
export const ClosedIssue: Story = { args: { preview: { ...preview, state: 'closed' } } }
export const NoBodyOrMetadata: Story = {
	args: { preview: { ...preview, body: '', labels: [], assignees: [], authorLogin: null, comments: [] } },
}
