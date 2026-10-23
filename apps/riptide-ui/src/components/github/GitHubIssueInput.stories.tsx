import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubIssueInput } from '@/components/GitHubIssueInput'

const meta = {
	title: 'Components/GitHub/IssueInput',
	component: GitHubIssueInput,
	parameters: { layout: 'centered' },
	decorators: [(Story) => <div className="w-[min(34rem,calc(100vw-2rem))]"><Story /></div>],
	args: { value: '482', onChange: fn() },
} satisfies Meta<typeof GitHubIssueInput>

export default meta
type Story = StoryObj<typeof meta>

export const IssueNumber: Story = {}
export const FullUrl: Story = { args: { value: 'https://github.com/acme/web-platform/issues/482' } }
export const Loading: Story = { args: { isFetching: true } }
export const UrlMismatch: Story = { args: { error: 'The issue URL does not match the selected repository.' } }
export const MissingPermission: Story = {
	args: { error: 'This installation needs Issues: read permission before it can preview issues.' },
}
