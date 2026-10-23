import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { LauncherTicketDialog } from './LauncherTicketDialog'

const meta = {
	title: 'Components/LauncherV3/TicketDialog',
	component: LauncherTicketDialog,
	args: {
		provider: 'linear',
		input: '',
		loading: false,
		error: null,
		resolvedName: null,
		githubRepositories: [],
		selectedGitHubRepositoryId: null,
		onInputChange: fn(),
		onSelectGitHubRepository: fn(),
		onAttach: fn(),
		onClose: fn(),
	},
} satisfies Meta<typeof LauncherTicketDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Resolved: Story = {
	args: {
		input: 'ENG-1234',
		resolvedName: '[ENG-1234] Fix session launch stalls',
	},
}

export const Loading: Story = {
	args: { input: 'ENG-1234', loading: true },
}

export const LookupError: Story = {
	args: {
		input: 'ENG-9999',
		error: "Couldn't load Linear ticket ENG-9999. It may not exist, or the integration may not have access.",
	},
}

export const GitHubRepositoryChoice: Story = {
	args: {
		provider: 'github',
		input: '42',
		resolvedName: '[acme/web#42] Fix flaky preview',
		githubRepositories: [
			{
				connectionId: '11111111-1111-4111-8111-111111111111',
				repositoryId: '77',
				fullName: 'acme/web',
				accountLogin: 'acme',
				private: false,
				archived: false,
			},
			{
				connectionId: '11111111-1111-4111-8111-111111111111',
				repositoryId: '78',
				fullName: 'acme/api',
				accountLogin: 'acme',
				private: true,
				archived: false,
			},
		],
		selectedGitHubRepositoryId: '77',
	},
}
