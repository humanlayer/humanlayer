import type { Meta, StoryObj } from '@storybook/react-vite'

import { MultiplayerPromptingStatus } from './MultiplayerPromptingStatus'

const participants = [
	{
		id: 'ada',
		email: 'ada@example.com',
		firstName: 'Ada',
		lastName: 'Chen',
		profilePictureUrl: 'https://github.com/evilrabbit.png',
	},
	{
		id: 'bob',
		email: 'bob@example.com',
		firstName: 'Bob',
		lastName: 'Park',
		profilePictureUrl: 'https://github.com/shadcn.png',
	},
	{
		id: 'cam',
		email: 'cam@example.com',
		firstName: 'Cam',
		lastName: 'Rivera',
		profilePictureUrl: 'https://github.com/humanlayer.png',
	},
	{
		id: 'dev',
		email: 'dev@example.com',
		firstName: 'Dev',
		lastName: 'Diaz',
		profilePictureUrl: 'https://i.pravatar.cc/32?u=dev',
	},
	{
		id: 'eve',
		email: 'eve@example.com',
		firstName: 'Eve',
		lastName: 'Evans',
		profilePictureUrl: 'https://i.pravatar.cc/32?u=eve',
	},
]

const meta = {
	title: 'Components/MultiplayerPromptingStatus',
	component: MultiplayerPromptingStatus,
	parameters: { layout: 'centered' },
	args: {
		participants,
		countdown: '29m',
		isOwner: true,
	},
} satisfies Meta<typeof MultiplayerPromptingStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Owner: Story = {
	args: { onManage: () => {} },
}

export const Collaborator: Story = {
	args: { isOwner: false },
}

export const ThreePeople: Story = {
	args: { participants: participants.slice(0, 3), countdown: '1h 42m' },
}
