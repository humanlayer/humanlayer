import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { Button } from '@humanlayer/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react'
import { ChevronsRight, Menu, ShieldOff, SkipForward } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MobileArtifactSheet, type MobileArtifactItem } from '@/mobile/components/pure/MobileArtifactSheet'
import {
	MobileInput,
	type MobileInputControl,
	type MobileInputStatusTone,
	type MobileInputSubmitMode,
} from '@/mobile/components/pure/MobileInput'
import { MobileModelSelector, type MobileModelOption } from '@/mobile/components/pure/MobileModelSelector'
import { MobileSessionDetailPage, type MobileSessionDetailPageProps } from './MobileSessionDetailPage'

const meta: Meta<typeof MobileSessionDetailPage> = {
	title: 'Mobile/Pages/MobileSessionDetailPage',
	component: MobileSessionDetailPage,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileSessionDetailPage>

const SAMPLE_MODELS: MobileModelOption[] = [
	{ value: 'opus', label: 'OPUS' },
	{ value: 'claude-opus-4-8', label: 'OPUS 4.8' },
	{ value: 'claude-opus-4-7', label: 'OPUS 4.7' },
	{ value: 'sonnet', label: 'SONNET' },
	{ value: 'claude-sonnet-5', label: 'SONNET 5' },
	{ value: 'claude-sonnet-4-6', label: 'SONNET 4.6' },
	{ value: 'claude-haiku-4-5-20251001', label: 'HAIKU 4.5' },
]

interface InteractivePageProps
	extends Omit<MobileSessionDetailPageProps, 'composer' | 'onApproveWithSuggestions' | 'onCancelDeny'> {
	onSend: () => void
	inputDisabled?: boolean
	inputStatusLabel?: string
	inputStatusTone?: MobileInputStatusTone
	inputControls?: MobileInputControl[]
	inputSubmitMode?: MobileInputSubmitMode
	inputModelValue?: string
	inputModelOptions?: MobileModelOption[]
	onInputModelChange?: (value: string) => void
	inputModelSelectorOpen?: boolean
	onInputModelSelectorOpenChange?: (open: boolean) => void
}

// Fully stateful wrapper for interactive stories
function InteractivePage(props: InteractivePageProps) {
	const [inputValue, setInputValue] = useState('')
	const [modelValue, setModelValue] = useState(SAMPLE_MODELS[0].value)
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
	const [bypassEnabled, setBypassEnabled] = useState(false)
	const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false)
	const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true)

	const defaultControls = useMemo<MobileInputControl[]>(
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
	const resolvedModelValue = props.inputModelValue ?? modelValue
	const resolvedModelOptions = props.inputModelOptions ?? SAMPLE_MODELS
	const resolvedModelLabel =
		resolvedModelOptions.find((option) => option.value === resolvedModelValue)?.label ?? resolvedModelValue
	const resolvedModelSelectorOpen = props.inputModelSelectorOpen ?? modelSelectorOpen
	const handleModelSelectorOpenChange = props.onInputModelSelectorOpenChange ?? setModelSelectorOpen
	const handleModelChange = props.onInputModelChange ?? setModelValue
	const composer = (
		<>
			<MobileInput
				value={inputValue}
				onChange={setInputValue}
				onSend={props.onSend}
				disabled={props.inputDisabled}
				statusLabel={props.inputStatusLabel ?? 'READY FOR INPUT'}
				statusTone={props.inputStatusTone ?? 'success'}
				controls={props.inputControls ?? defaultControls}
				submitMode={props.inputSubmitMode ?? 'send'}
				modelLabel={resolvedModelLabel}
				onModelClick={() => handleModelSelectorOpenChange(true)}
			/>
			<MobileModelSelector
				open={resolvedModelSelectorOpen}
				onOpenChange={handleModelSelectorOpenChange}
				value={resolvedModelValue}
				options={resolvedModelOptions}
				onChange={handleModelChange}
			/>
		</>
	)

	return (
		<MobileSessionDetailPage
			onApproveWithSuggestions={(id) => console.log('approveWithSuggestions', id)}
			onCancelDeny={() => console.log('cancelDeny')}
			{...props}
			composer={composer}
		/>
	)
}

// ----------------------------------------------------------------------------
// Fixtures: JWT token-expiry debugging narrative
// ----------------------------------------------------------------------------

let idCounter = 1
function nextId() {
	return `evt-${idCounter++}`
}

function makeEvent(overrides: Partial<ConversationEvent> & Pick<ConversationEvent, 'eventType'>): ConversationEvent {
	return {
		id: nextId(),
		sessionId: 'session-1',
		createdAt: new Date(),
		...overrides,
	}
}

// User question
const userAsk = makeEvent({
	eventType: 'message',
	role: 'user',
	content:
		'Fix the JWT token expiry issue — tokens are expiring after 15 minutes instead of 24 hours.',
})

// Assistant plan
const assistantPlan = makeEvent({
	eventType: 'message',
	role: 'assistant',
	content: "I'll look at the token configuration to understand the current expiry settings and fix them.",
})

// Grep tool call + result
const grepToolId = 'grep-1'
const grepCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Grep',
	toolId: grepToolId,
	isCompleted: true,
	toolInputJson: JSON.stringify({
		pattern: 'expiresIn|expiry|ttl',
		path: 'apps/codelayer-api/src/auth/',
		output_mode: 'content',
	}),
})
const grepResult = makeEvent({
	eventType: 'tool_result',
	toolId: grepToolId,
	toolResultForId: grepCall.id,
	toolResultContent:
		'apps/codelayer-api/src/auth/tokens.ts:12:  expiresIn: "15m",\napps/codelayer-api/src/auth/tokens.ts:28:  expiresIn: "15m",',
})

// Assistant follow-up
const assistantFindings = makeEvent({
	eventType: 'message',
	role: 'assistant',
	content:
		"Found the issue. Both access and refresh tokens are set to 15 minutes. I'll update the access token to 24h and the refresh token to 7 days.",
})

// Edit tool call + result
const editToolId = 'edit-1'
const editCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Edit',
	toolId: editToolId,
	isCompleted: true,
	toolInputJson: JSON.stringify({
		file_path: 'apps/codelayer-api/src/auth/tokens.ts',
		old_string: "expiresIn: '15m',",
		new_string: "expiresIn: '24h',",
	}),
})
const editResult = makeEvent({
	eventType: 'tool_result',
	toolId: editToolId,
	toolResultForId: editCall.id,
	toolResultContent: 'File updated successfully.',
})

// Assistant wrap-up
const assistantWrap = makeEvent({
	eventType: 'message',
	role: 'assistant',
	content:
		'Done. Both token expiry values have been updated:\n• Access token: 15m → 24h\n• Refresh token: 15m → 7d\n\nThe changes are in `apps/codelayer-api/src/auth/tokens.ts`.',
})

// A longer, multiline follow-up from the user — with a fenced code block — to
// show the user bubble holding real content next to full-width assistant text.
const userFollowUp = makeEvent({
	eventType: 'message',
	role: 'user',
	content: `Nice. One more thing — the refresh token rotation still uses the old constant. Can you point it at the new value too?

\`\`\`ts
// apps/codelayer-api/src/auth/rotate.ts
const REFRESH_EXPIRY = '15m' // <- should be 7d now
\`\`\`

Then run the auth suite to confirm nothing regressed.`,
})

const assistantFollowUpAck = makeEvent({
	eventType: 'message',
	role: 'assistant',
	content: "Good catch — I'll update `rotate.ts` to use the 7d value and re-run the auth suite.",
})

const SAMPLE_EVENTS: ConversationEvent[] = [
	userAsk,
	assistantPlan,
	grepCall,
	grepResult,
	assistantFindings,
	editCall,
	editResult,
	assistantWrap,
	userFollowUp,
	assistantFollowUpAck,
]

const SAMPLE_TOOL_RESULTS: Record<string, ConversationEvent> = {
	[grepToolId]: grepResult,
	[editToolId]: editResult,
}

const SAMPLE_ARTIFACTS: MobileArtifactItem[] = [
	{ artifactId: 'art-1', filename: 'apps/codelayer-api/src/auth/tokens.ts', category: 'edited' },
	{ artifactId: 'art-2', filename: 'apps/codelayer-api/src/auth/middleware.ts', category: 'source' },
]

const SAMPLE_ARTIFACT_TRIGGER = (
	<Button variant="ghost" size="icon" className="size-11" aria-label="Open artifacts">
		<Menu className="h-5 w-5" />
	</Button>
)

// ----------------------------------------------------------------------------
// Stories
// ----------------------------------------------------------------------------

export const WithMessages: Story = {
	render: () => (
		<InteractivePage
			sessionId="session-1"
			sessionTitle="Fix authentication bug"
			onBack={() => {}}
			events={SAMPLE_EVENTS}
			toolResultsByKey={SAMPLE_TOOL_RESULTS}
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
			approvingApprovalId={null}
			onSend={() => {}}
			inputDisabled={false}
			artifactTrigger={SAMPLE_ARTIFACT_TRIGGER}
		/>
	),
}

// Pending approval narrative
const pendingDeployToolId = 'bash-deploy'
const pendingDeployCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: pendingDeployToolId,
	approvalStatus: 'pending',
	approvalId: 'approval-123',
	toolInputJson: JSON.stringify({
		command: 'bun run deploy:production --env=prod --tag=v2.4.1',
		description: 'Deploy v2.4.1 to production',
	}),
})

const PENDING_APPROVAL_EVENTS: ConversationEvent[] = [
	makeEvent({
		eventType: 'message',
		role: 'user',
		content: 'Deploy the latest build to production.',
	}),
	makeEvent({
		eventType: 'message',
		role: 'assistant',
		content: "I'll run the deployment script. This requires your approval.",
	}),
	pendingDeployCall,
]

export const WithPendingApproval: Story = {
	render: () => (
		<InteractivePage
			sessionId="session-2"
			sessionTitle="Deploy to production"
			onBack={() => {}}
			events={PENDING_APPROVAL_EVENTS}
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
			approvingApprovalId={null}
			onSend={() => {}}
			inputDisabled={false}
		/>
	),
}

export const RunningQueueComposer: Story = {
	render: () => (
		<InteractivePage
			sessionId="session-5"
			sessionTitle="Investigate flaky auth tests"
			onBack={() => {}}
			events={SAMPLE_EVENTS.slice(0, 5)}
			toolResultsByKey={SAMPLE_TOOL_RESULTS}
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
			approvingApprovalId={null}
			onSend={() => {}}
			inputStatusLabel="RUNNING"
			inputStatusTone="success"
			inputSubmitMode="queue"
			queuedMessages={[
				{ id: 'q1', content: 'Also update the changelog once the tests pass.' },
				{ id: 'q2', content: 'Then push and open the PR against main.' },
			]}
			onQueuedSendNow={(id) => console.log('send now', id)}
			onQueuedRemove={(id) => console.log('remove', id)}
			artifactTrigger={SAMPLE_ARTIFACT_TRIGGER}
		/>
	),
}

// Stream redesign: thinking line + a consecutive run of tool calls that groups
// into a single collapsible block.
const streamThinking = makeEvent({
	eventType: 'thinking',
	role: 'assistant',
	content:
		"The tokens are expiring too early. I'll grep for the config, read the file, patch the expiry, then run the tests to confirm.",
})
const streamRead = makeEvent({
	eventType: 'tool_call',
	toolName: 'Read',
	toolId: 'read-2',
	isCompleted: true,
	toolInputJson: JSON.stringify({ file_path: 'apps/codelayer-api/src/auth/tokens.ts' }),
})
const streamBash = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'bash-2',
	isCompleted: true,
	toolInputJson: JSON.stringify({
		command: 'bun run test --filter @humanlayer/api',
		description: 'Run auth tests',
	}),
})

// user → thinking → assistant → [grep, read, edit, bash] consecutive → assistant
const STREAM_REDESIGN_EVENTS: ConversationEvent[] = [
	userAsk,
	streamThinking,
	assistantPlan,
	grepCall,
	grepResult,
	streamRead,
	editCall,
	editResult,
	streamBash,
	assistantWrap,
]

export const StreamRedesign: Story = {
	render: () => (
		<InteractivePage
			sessionId="session-6"
			sessionTitle="Fix JWT token expiry"
			onBack={() => {}}
			events={STREAM_REDESIGN_EVENTS}
			toolResultsByKey={SAMPLE_TOOL_RESULTS}
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
			approvingApprovalId={null}
			onSend={() => {}}
			artifactTrigger={SAMPLE_ARTIFACT_TRIGGER}
		/>
	),
}

export const WithArtifactSheetOpen: Story = {
	render: () => {
		const ARTIFACT_CONTENT = `import jwt from 'jsonwebtoken'

const ACCESS_TOKEN_EXPIRY = '24h'
const REFRESH_TOKEN_EXPIRY = '7d'

export function createAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  })
}

export function createRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  })
}
`
		return (
			<MobileSessionDetailPage
				sessionId="session-1"
				sessionTitle="Fix authentication bug"
				onBack={() => {}}
				events={SAMPLE_EVENTS}
				toolResultsByKey={SAMPLE_TOOL_RESULTS}
				onApprove={(id) => console.log('approve', id)}
				onDeny={(id) => console.log('deny', id)}
				onApproveWithSuggestions={(id) => console.log('approveWithSuggestions', id)}
				onCancelDeny={() => console.log('cancelDeny')}
				approvingApprovalId={null}
				composer={<MobileInput value="" onChange={() => {}} onSend={() => {}} disabled={false} />}
				artifactTrigger={SAMPLE_ARTIFACT_TRIGGER}
				artifactSheet={
					<MobileArtifactSheet
						isOpen
						onOpenChange={() => {}}
						artifacts={SAMPLE_ARTIFACTS}
						selectedArtifactId="art-1"
						selectedArtifactContent={ARTIFACT_CONTENT}
						onArtifactSelect={(id) => console.log('select', id)}
						onArtifactClose={() => console.log('close')}
						viewMode="raw"
						onViewModeChange={() => {}}
					/>
				}
			/>
		)
	},
}
