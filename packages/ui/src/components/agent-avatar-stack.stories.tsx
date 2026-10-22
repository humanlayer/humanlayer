import type { Meta, StoryObj } from '@storybook/react'
import { mockUsers } from './__stories__/comment-fixtures'
import { AgentAvatarStack } from './agent-avatar-stack'

const meta = {
	title: 'Comments/AgentAvatarStack',
	component: AgentAvatarStack,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="p-8">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AgentAvatarStack>

export default meta
type Story = StoryObj<typeof meta>

export const CommentCardSize: Story = {
	args: {
		authorDisplayName: mockUsers.user1.displayName,
		authorAvatarUrl: mockUsers.user1.avatarUrl,
		authorFallbackId: mockUsers.user1.userId,
		avatarClassName: 'size-5',
	},
}

export const ToastSize: Story = {
	args: {
		authorDisplayName: mockUsers.user1.displayName,
		authorAvatarUrl: mockUsers.user1.avatarUrl,
		authorFallbackId: mockUsers.user1.userId,
		avatarClassName: 'size-4',
	},
}

export const LongDisplayName: Story = {
	args: {
		authorDisplayName: 'Alexander Bartholomew Constantine III',
		authorAvatarUrl: mockUsers.user2.avatarUrl,
		authorFallbackId: mockUsers.user2.userId,
		avatarClassName: 'size-5',
	},
}

export const NoAvatarUrl: Story = {
	args: {
		authorDisplayName: 'Jane Doe',
		authorAvatarUrl: undefined,
		authorFallbackId: 'user_unknown',
		avatarClassName: 'size-5',
	},
}
