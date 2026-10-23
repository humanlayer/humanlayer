import type { Meta, StoryObj } from '@storybook/react'
import { ChevronsRight, ShieldOff, SkipForward } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { HostOfflineBadge } from '@/components/HostOfflineBadge'
import { SessionCostBadge } from '@/components/SessionCostBadge'
import { TokenUsageBadge } from '@/components/TokenUsageBadge'
import { MobileEffortSelector } from './MobileEffortSelector'
import {
	MobileInput,
	type MobileInputAttachment,
	type MobileInputControl,
	type MobileInputStatusTone,
	type MobileInputSubmitMode,
} from './MobileInput'
import { MobileModelSelector, type MobileModelOption } from './MobileModelSelector'

const meta: Meta<typeof MobileInput> = {
	title: 'Mobile/MobileInput',
	component: MobileInput,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileInput>

const SAMPLE_MODELS: MobileModelOption[] = [
	{ value: 'opus', label: 'OPUS' },
	{ value: 'claude-opus-4-8', label: 'OPUS 4.8' },
	{ value: 'claude-opus-4-7', label: 'OPUS 4.7' },
	{ value: 'sonnet', label: 'SONNET' },
	{ value: 'claude-sonnet-5', label: 'SONNET 5' },
	{ value: 'claude-sonnet-4-6', label: 'SONNET 4.6' },
	{ value: 'claude-haiku-4-5-20251001', label: 'HAIKU 4.5' },
]

const SAMPLE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

function PolishedComposer({
	initialValue = '',
	statusLabel = 'READY FOR INPUT',
	statusTone = 'success',
	submitMode = 'send',
	disabled = false,
	submitDisabled = false,
	showEffort = true,
	showFastMode = false,
	infoRow,
	withInterrupt = false,
	denyMode = false,
	initialAttachments = [],
	pendingUploadCount = 0,
}: {
	initialValue?: string
	statusLabel?: string
	statusTone?: MobileInputStatusTone
	submitMode?: MobileInputSubmitMode
	disabled?: boolean
	submitDisabled?: boolean
	showEffort?: boolean
	showFastMode?: boolean
	infoRow?: React.ReactNode
	withInterrupt?: boolean
	denyMode?: boolean
	initialAttachments?: MobileInputAttachment[]
	pendingUploadCount?: number
}) {
	const [value, setValue] = useState(initialValue)
	const [attachments, setAttachments] = useState<MobileInputAttachment[]>(initialAttachments)
	const [modelValue, setModelValue] = useState(SAMPLE_MODELS[0].value)
	const [modelOpen, setModelOpen] = useState(false)
	const [effortValue, setEffortValue] = useState<string | null>('high')
	const [effortOpen, setEffortOpen] = useState(false)
	const [fastModeEnabled, setFastModeEnabled] = useState(false)
	const [fastModePending, setFastModePending] = useState(false)
	const [bypassEnabled, setBypassEnabled] = useState(false)
	const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false)
	const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true)

	const currentModelLabel = SAMPLE_MODELS.find((option) => option.value === modelValue)?.label ?? modelValue

	const controls = useMemo<MobileInputControl[]>(
		() => [
			{
				id: 'bypass',
				label: 'Toggle bypass permissions',
				icon: <ShieldOff className="h-4 w-4" />,
				active: bypassEnabled,
				tone: 'error',
				onClick: () => setBypassEnabled((current) => !current),
			},
			{
				id: 'auto-accept',
				label: 'Toggle auto-accept edits',
				icon: <ChevronsRight className="h-4 w-4" />,
				active: autoAcceptEnabled,
				tone: 'warning',
				onClick: () => setAutoAcceptEnabled((current) => !current),
			},
			{
				id: 'auto-advance',
				label: 'Toggle auto-advance',
				icon: <SkipForward className="h-4 w-4" />,
				active: autoAdvanceEnabled,
				tone: 'success',
				onClick: () => setAutoAdvanceEnabled((current) => !current),
			},
		],
		[autoAcceptEnabled, autoAdvanceEnabled, bypassEnabled],
	)

	return (
		<>
			<MobileInput
				value={value}
				onChange={setValue}
				onSend={() => console.log('submit', { value, submitMode })}
				statusLabel={statusLabel}
				statusTone={statusTone}
				modelLabel={currentModelLabel}
				onModelClick={() => setModelOpen(true)}
				showEffort={showEffort}
				effortLabel={(effortValue ?? 'effort').toUpperCase()}
				onEffortClick={() => setEffortOpen(true)}
				showFastMode={showFastMode}
				fastModeEnabled={fastModeEnabled}
				onFastModeToggle={(next) => {
					if (next) setFastModePending(true)
					else setFastModeEnabled(false)
				}}
				infoRow={infoRow}
				controls={controls}
				submitMode={submitMode}
				disabled={disabled}
				submitDisabled={submitDisabled}
				attachments={attachments}
				onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
				pendingUploadCount={pendingUploadCount}
				onInterrupt={withInterrupt ? () => console.log('interrupt') : undefined}
				denyMode={denyMode}
				onCancelDeny={denyMode ? () => console.log('cancel deny') : undefined}
			/>
			<MobileModelSelector
				open={modelOpen}
				onOpenChange={setModelOpen}
				value={modelValue}
				options={SAMPLE_MODELS}
				onChange={setModelValue}
			/>
			<MobileEffortSelector
				open={effortOpen}
				onOpenChange={setEffortOpen}
				value={effortValue}
				levels={SAMPLE_EFFORT_LEVELS}
				onChange={setEffortValue}
			/>
			<FastModeWarningDialog
				open={fastModePending}
				onOpenChange={setFastModePending}
				onConfirm={() => setFastModeEnabled(true)}
			/>
		</>
	)
}

export const WithModelAndControls: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer initialValue="Patch the JWT expiry bug." />
		</div>
	),
}

export const WithEffortAndFastMode: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer initialValue="Refactor the auth middleware." showEffort showFastMode />
		</div>
	),
}

export const WithUsageBadges: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer
				initialValue="Summarize the changes so far."
				infoRow={
					<>
						<TokenUsageBadge
							contextWindowTokens={142_000}
							contextWindowLimit={168_000}
							provider="anthropic"
							model="claude-opus-4-8"
							condensed
						/>
						<SessionCostBadge
							totalCostUsd={1.234}
							modelUsage={{ 'claude-opus-4-8': { input_tokens: 120_000, output_tokens: 8_000 } }}
						/>
					</>
				}
			/>
		</div>
	),
}

export const WithErrorAndHostOffline: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer
				statusLabel="FAILED"
				statusTone="error"
				submitDisabled
				infoRow={
					<>
						<HostOfflineBadge hostName="a1b2c3" action={null} />
						<span className="max-w-full break-words font-mono text-xs uppercase tracking-wider text-[var(--terminal-error)]">
							Session exited unexpectedly (code 1)
						</span>
					</>
				}
			/>
		</div>
	),
}

// Running with text: stop button (interrupt, keeps the draft) next to the clock
// button (queue) — mirrors the desktop Interrupt + Queue actions while running.
export const RunningQueueMode: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer
				initialValue="Queue this after the current bash step finishes."
				statusLabel="RUNNING"
				statusTone="success"
				submitMode="queue"
				withInterrupt
			/>
		</div>
	),
}

// Running with an empty draft: the clock is disabled until there's content;
// the stop button stays available to interrupt.
export const RunningInterruptMode: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer statusLabel="RUNNING" statusTone="success" submitMode="queue" withInterrupt />
		</div>
	),
}

// Attached files render as removable chips above the textarea.
export const WithAttachments: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer
				initialValue="Use these mockups for the redesign."
				initialAttachments={[
					{ id: '@.humanlayer/tasks/eng-1234/mockup.png', label: 'mockup.png' },
					{ id: '@.humanlayer/tasks/eng-1234/notes.md', label: 'notes.md' },
				]}
			/>
		</div>
	),
}

// Deny-with-feedback: composer denies the pending approval with optional feedback.
export const DenyWithFeedback: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-background">
			<div className="flex-1" />
			<PolishedComposer
				statusLabel="TELL CLAUDE WHAT TO DO DIFFERENTLY"
				statusTone="error"
				denyMode
			/>
		</div>
	),
}
