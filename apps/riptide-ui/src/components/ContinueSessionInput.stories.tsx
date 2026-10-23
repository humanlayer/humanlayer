import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE } from '@/lib/context-warning'
import { ContinueSessionInputPure } from './ContinueSessionInput'

const meta: Meta<typeof ContinueSessionInputPure> = {
	title: 'Components/ContinueSessionInput',
	component: ContinueSessionInputPure,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="w-full max-w-3xl p-4 bg-background">
				<Story />
			</div>
		),
	],
	args: {
		sessionId: 'story-session-id',
		onSubmit: fn(),
		canPrompt: true,
		canManageSession: true,
		multiplayerPromptingControl: <></>,
		onFocusChange: fn(),
		onToggleBypass: fn(),
		onPermissionModeChange: fn(),
		onToggleArchive: fn(),
		onModelSelectorOpenChange: fn(),
		updateSessionModel: fn(),
		updateSessionEffort: fn(),
		updateSessionFastMode: fn(),
	},
}

export default meta
type Story = StoryObj<typeof ContinueSessionInputPure>

export const Default: Story = {
	name: 'Default (Ready for Input)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Running: Story = {
	name: 'Running Status',
	args: {
		sessionStatus: 'running',
		isSubmitting: false,
		disabled: true,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 84000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Submitting: Story = {
	name: 'Sending Message',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: true,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 100000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const FailedSession: Story = {
	name: 'Failed Session',
	args: {
		sessionStatus: 'failed',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 50000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		errorMessage: 'PROCESS EXITED WITH CODE 1',
	},
}

export const LostSession: Story = {
	name: 'Lost Session',
	args: {
		sessionStatus: 'lost',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 50000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		errorMessage:
			'This session is marked as running but has not sent an event in over 10 minutes. You can try resuming it by sending another message.',
	},
}

export const FailedSessionLongError: Story = {
	name: 'Failed Session (Long Error Message)',
	args: {
		sessionStatus: 'failed',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 150000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		errorMessage: 'CLAUDE CODE PROCESS TERMINATED UNEXPECTEDLY DUE TO MEMORY LIMIT EXCEEDED',
	},
}

export const FailedSessionNoError: Story = {
	name: 'Failed Session (No Error Message)',
	args: {
		sessionStatus: 'failed',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 50000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		errorMessage: null,
	},
}

export const BypassEnabled: Story = {
	name: 'Bypass Permissions Enabled',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'bypass',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const AutoAcceptEnabled: Story = {
	name: 'Auto-Accept Edits Enabled',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'accept_edits',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const AutoMode: Story = {
	name: 'Auto Mode',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'auto',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		codingAgent: 'claude',
	},
}

export const NonClaudeHarness: Story = {
	name: 'Non-Claude Harness (selector disabled)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 168000,
		model: 'gpt-4o',
		codingAgent: 'codelayer',
	},
}

export const Archived: Story = {
	name: 'Archived Session',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: true,
		contextWindowTokens: 120000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const CriticalTokenUsage: Story = {
	name: 'Critical Token Usage (92%)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 890560,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const CodelayerPersistedRuntimeLimit: Story = {
	name: 'CodeLayer Persisted Runtime Limit',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 120000,
		contextWindowLimit: 256000,
		model: 'gpt-4o',
		codingAgent: 'codelayer',
	},
}

export const NoTokenData: Story = {
	name: 'No Token Data',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: undefined,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Interrupted: Story = {
	name: 'Interrupted Session',
	args: {
		sessionStatus: 'interrupted',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 80000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Launching: Story = {
	name: 'Launching Status',
	args: {
		sessionStatus: 'launching',
		isSubmitting: false,
		disabled: true,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 0,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const HostOfflineColocated: Story = {
	name: 'Host Offline (Launch Available)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		isHostOffline: true,
		hostName: 'Local MacBook Pro',
		canLaunchLocalDaemon: true,
		onLaunchDaemon: fn(),
	},
}

export const HostOfflineRemote: Story = {
	name: 'Host Offline (Launch Unavailable)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		isHostOffline: true,
		hostName: 'Remote Linux Host',
		canLaunchLocalDaemon: false,
	},
}

export const ApprovalNeeded: Story = {
	name: 'Approval Needed Status',
	args: {
		sessionStatus: 'needs_approval',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 65000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const InterruptRequested: Story = {
	name: 'Interrupt Requested Status',
	args: {
		sessionStatus: 'interrupt_requested',
		isSubmitting: false,
		disabled: true,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 95000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Resuming: Story = {
	name: 'Resuming Status',
	args: {
		sessionStatus: 'resuming',
		isSubmitting: false,
		disabled: true,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 75000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Draft: Story = {
	name: 'Draft Status',
	args: {
		sessionStatus: 'draft',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 0,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const DenialMode: Story = {
	name: 'Denial Mode (Rejecting Approval)',
	args: {
		sessionStatus: 'needs_approval',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 65000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		isDenying: true,
		denyingToolName: 'Bash',
		onCancelDeny: fn(),
		onSubmitDeny: fn(),
	},
}

export const DenialModeSubmitting: Story = {
	name: 'Denial Mode (Submitting)',
	args: {
		sessionStatus: 'needs_approval',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 65000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		isDenying: true,
		denyingToolName: 'Bash',
		onCancelDeny: fn(),
		onSubmitDeny: fn(),
		isDenySubmitting: true,
	},
}

export const UploadingOneFile: Story = {
	name: 'Uploading 1 File',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		pendingUploadCount: 1,
	},
}

export const UploadingMultipleFiles: Story = {
	name: 'Uploading 3 Files',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 42000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
		pendingUploadCount: 3,
	},
}

export const RunningWithQueue: Story = {
	name: 'Running With Queue (has text → Queue + Interrupt & Send buttons)',
	args: {
		sessionStatus: 'running',
		onQueue: fn(),
		onInterrupt: fn(),
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 84000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const RunningWithQueueNoText: Story = {
	name: 'Running With Queue (no text → Interrupt button only)',
	args: {
		sessionStatus: 'running',
		onQueue: fn(),
		onInterrupt: fn(),
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		contextWindowTokens: 84000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

// Narrow-width variants — pin the wrapper below the 680px threshold so
// ResizeObserver reports isNarrow=true and the icon-only forms render.

export const RunningWithQueueNarrow: Story = {
	name: 'Running With Queue — Narrow (QueueSplitButton)',
	args: RunningWithQueue.args,
	decorators: [
		(Story) => (
			<div className="max-w-md">
				<Story />
			</div>
		),
	],
}

export const RunningWithQueueNoTextNarrow: Story = {
	name: 'Running With Queue No Text — Narrow (icon-only buttons)',
	args: RunningWithQueueNoText.args,
	decorators: [
		(Story) => (
			<div className="max-w-md">
				<Story />
			</div>
		),
	],
}

export const ApprovalNeededNarrow: Story = {
	name: 'Approval Needed — Narrow (icon-only Interrupt button)',
	args: {
		...ApprovalNeeded.args,
		onInterrupt: fn(),
	},
	decorators: [
		(Story) => (
			<div className="max-w-md">
				<Story />
			</div>
		),
	],
}

export const CriticalTokenUsageWithIterateButton: Story = {
	name: 'Critical Token Usage — Wide (labeled iterate button)',
	args: {
		...CriticalTokenUsage.args,
		// provide iterateSlashCommand so showIterateButton is true
		iterateSlashCommand: '/iterate',
		onIterateInNewSession: fn(),
		// ensure contextWindowTokens meets the threshold
		contextWindowTokens: CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE + 1,
	},
}

// Large-context (1M) model: the warning banner + iterate button only fire once
// the session passes the 200k tier, not the standard 100k tier.
export const LargeModelAboveThreshold: Story = {
	name: 'Large Model (1M) — Above 200k Threshold (banner + iterate button)',
	args: {
		sessionStatus: 'ready_for_input',
		isSubmitting: false,
		disabled: false,
		permissionsMode: 'default',
		isArchived: false,
		// Base 4.8 derives an effective window of 968k, so it warns at 200k.
		model: 'claude-opus-4-8',
		contextWindowTokens: CONTEXT_WARNING_TOKEN_THRESHOLD_LARGE + 1,
		contextWindowLimit: 968000,
		iterateSlashCommand: '/iterate',
		onIterateInNewSession: fn(),
	},
}

// Same 1M model below the 200k tier (but above the old 100k value): badge shows,
// but the banner / iterate button must NOT appear.
export const LargeModelBelowThreshold: Story = {
	name: 'Large Model (1M) — Below 200k Threshold (no banner, no iterate button)',
	args: {
		...LargeModelAboveThreshold.args,
		// 150k is above the standard 100k trigger but below the 200k large tier.
		contextWindowTokens: 150000,
	},
}
