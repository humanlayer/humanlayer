import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { mockUsers } from './__stories__/comment-fixtures'
import { NewCommentForm } from './new-comment-form'

const meta = {
	title: 'Comments/NewCommentForm',
	component: NewCommentForm,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
	args: {
		artifactId: 'artifact_story',
		onSubmit: fn(),
		onCancelHighlight: fn(),
		currentUserDisplayName: mockUsers.user1.displayName,
	},
	decorators: [
		(Story) => (
			<div className="w-96 p-4 border rounded-md">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof NewCommentForm>

export default meta
type Story = StoryObj<typeof meta>

export const SpanlessMode: Story = {
	args: {},
}

export const WithPendingAnchor: Story = {
	args: {
		pendingCommentAnchor: {
			commentedUponBlockText: 'const result = await fetchData()',
			previousBlockText: 'import { fetchData } from "./api"',
			nextBlockText: 'return result.data',
		},
	},
}
