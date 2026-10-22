import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'

import { TaskSummaryPure } from './TaskSummary'

const meta = {
	title: 'Components/TaskSummary',
	component: TaskSummaryPure,
	parameters: {
		layout: 'padded',
	},
	args: {
		task: {
			id: '123e4567-e89b-12d3-a456-426614174000',
			name: 'Implement task summary cleanup',
			slug: 'implement-task-summary-cleanup',
			default_working_directory: '/Users/kyle/projects/syncopate',
			organization_id: 'org-mock-id',
			resource_owner_user_id: 'user-mock-owner-id',
			workspace_state: null,
			workspace_spec: null,
			auto_advance_questions_to_research: false,
			auto_advance_research_to_design: false,
			auto_advance_plan_to_worktree: false,
			auto_advance_worktree_to_implementation: false,
			auto_advance_implementation_to_pr: false,
			slack_notifications_muted: false,
		},
		workspaceView: null,
		recentDirectories: ['/Users/kyle/projects/syncopate', '/Users/kyle/wt/syncopate/deslop-unused-vars'],
		nextStepType: null,
		hideActionsAndArtifacts: false,
		isSharedWithOrg: false,
		isOwner: true,
		showSlackNotificationControl: false,
		slackNotificationsMuted: false,
		isEditHidden: false,
		isCreateSessionHidden: false,
		participantMembers: [],
		displayWorkingDirectory: '/Users/kyle/projects/syncopate',
		onSaveName: fn(),
		onSaveDirectory: fn(),
		onCopyDirectory: fn(),
		onOpenDirectory: fn(),
		onWorkspaceFocus: fn(),
		onToggleTerminal: null,
		isTerminalOpen: false,
		onOpenPermissionsDialog: fn(),
		onToggleSlackNotifications: fn(),
		onCreateSession: fn(),
		onProceedToNextStep: fn(),
	},
} satisfies Meta<typeof TaskSummaryPure>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SharedWithOrg: Story = {
	args: {
		isSharedWithOrg: true,
	},
}

export const WithNextStep: Story = {
	args: {
		nextStepType: 'research',
	},
}
