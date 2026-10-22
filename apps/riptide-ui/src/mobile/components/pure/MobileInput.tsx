import { Button } from '@humanlayer/ui/components/button'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { cn } from '@humanlayer/ui/lib/utils'
import {
	ChevronUp,
	Clock3,
	Loader2,
	MessageCircleX,
	MessageSquareShare,
	Paperclip,
	Send,
	Square,
	X,
	Zap,
} from 'lucide-react'
import type { FC, KeyboardEvent, ReactNode } from 'react'

export type MobileInputStatusTone = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'muted'

/** 'queue' — the session is busy (running / waiting on an approval): the primary
 * action queues the message and a stop button offers interrupt. 'send' — normal
 * continue-session submit. */
export type MobileInputSubmitMode = 'send' | 'queue'

export type MobileInputControlTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

export interface MobileInputControl {
	id: string
	label: string
	icon: ReactNode
	active?: boolean
	disabled?: boolean
	tone?: MobileInputControlTone
	onClick: () => void
}

/** A file attached to the composer, shown as a removable chip. */
export interface MobileInputAttachment {
	/** File-mention id (e.g. `@.humanlayer/tasks/<slug>/<file>`) — appended to the sent text. */
	id: string
	/** Display label (filename). */
	label: string
}

export interface MobileInputProps {
	value: string
	onChange: (value: string) => void
	onSend: () => void
	placeholder?: string
	disabled?: boolean
	submitDisabled?: boolean

	/** Optional model selector button. When provided, renders a small pill above the input. */
	modelLabel?: string
	onModelClick?: () => void
	modelDisabled?: boolean

	/** Optional effort selector pill. Rendered next to the model pill when `showEffort`
	 * is true and `onEffortClick` is provided (tapping opens a bottom Sheet owned by the parent). */
	showEffort?: boolean
	effortLabel?: string
	onEffortClick?: () => void
	effortDisabled?: boolean

	/** Optional Fast Mode toggle pill. Rendered next to the model pill when `showFastMode` is true. */
	showFastMode?: boolean
	fastModeEnabled?: boolean
	onFastModeToggle?: (next: boolean) => void
	fastModeDisabled?: boolean

	/** Optional context-window counter (e.g. TokenUsageBadge) rendered right-aligned
	 * on the same header row as the model/effort pills. Kept compact so the row fits. */
	contextCounter?: ReactNode

	/** Optional compact info row (token/cost/host-offline badges + error message) rendered
	 * below the header row and above the textarea. */
	infoRow?: ReactNode

	/** Optional session-status label shown above the input. */
	statusLabel?: string
	statusTone?: MobileInputStatusTone

	/** Optional control rail rendered across the bottom of the composer. */
	controls?: MobileInputControl[]
	actionButtons?: ReactNode
	submitMode?: MobileInputSubmitMode

	/** Attached files, rendered as removable chips above the textarea. */
	attachments?: MobileInputAttachment[]
	/** Remove an attachment by id. */
	onRemoveAttachment?: (id: string) => void
	/** Number of files still uploading — shown as an indicator; the parent should
	 * also disable submit while > 0 (mirrors desktop). */
	pendingUploadCount?: number

	/** Interrupt the session without sending (keeps the draft). When provided and
	 * `submitMode === 'queue'`, a stop button renders next to the clock/queue
	 * button (mirrors the desktop Interrupt button shown while running). */
	onInterrupt?: () => void
	interruptDisabled?: boolean

	/** Deny-with-feedback mode. When true the composer's primary action denies the
	 * pending approval with the typed feedback (text required, matching desktop's
	 * DENY button) and a Cancel action is shown. */
	denyMode?: boolean
	onCancelDeny?: () => void

	/** Unresolved artifact-comment count for the task. When > 0 and
	 * `onSendComments` is provided, a "send comments & resolve" button renders
	 * next to Send (mobile analog of the desktop SendCommentsSplitButton). */
	commentsCount?: number
	onSendComments?: () => void
	sendCommentsDisabled?: boolean
}

const EMPTY_CONTROLS: MobileInputControl[] = []
const EMPTY_ATTACHMENTS: MobileInputAttachment[] = []

const statusRailClasses: Record<MobileInputStatusTone, string> = {
	default: 'border-border',
	accent: 'border-[var(--terminal-accent)]',
	success: 'border-[var(--terminal-success)]',
	warning: 'border-[var(--terminal-warning)]',
	error: 'border-[var(--terminal-error)]',
	muted: 'border-muted-foreground/50',
}

const statusToneClasses: Record<MobileInputStatusTone, string> = {
	default: 'text-foreground/80',
	accent: 'text-[var(--terminal-accent)]',
	success: 'text-[var(--terminal-success)]',
	warning: 'text-[var(--terminal-warning)]',
	error: 'text-[var(--terminal-error)]',
	muted: 'text-muted-foreground',
}

const activeControlToneClasses: Record<MobileInputControlTone, string> = {
	neutral: 'border-border bg-muted/70 text-foreground',
	accent: 'border-[var(--terminal-accent)]/35 bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)]',
	success: 'border-[var(--terminal-success)]/35 bg-[var(--terminal-success)]/10 text-[var(--terminal-success)]',
	warning: 'border-[var(--terminal-warning)]/35 bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)]',
	error: 'border-[var(--terminal-error)]/35 bg-[var(--terminal-error)]/10 text-[var(--terminal-error)]',
}

const errorButtonClasses =
	'border-[var(--terminal-error)]/35 bg-[var(--terminal-error)]/10 text-[var(--terminal-error)] hover:bg-[var(--terminal-error)]/15'
const warningButtonClasses =
	'border-[var(--terminal-warning)]/35 bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)]/15'
const accentButtonClasses =
	'border-[var(--terminal-accent)]/35 bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)]/15'
const disabledButtonClasses = 'border-border bg-muted/50 text-muted-foreground hover:bg-muted/50'

function getSubmitButtonClasses(canSubmit: boolean, denyMode: boolean, submitMode: MobileInputSubmitMode): string {
	if (!canSubmit) return disabledButtonClasses
	if (denyMode) return errorButtonClasses
	if (submitMode === 'queue') return warningButtonClasses
	return accentButtonClasses
}

function getSubmitLabel(denyMode: boolean, submitMode: MobileInputSubmitMode): string {
	if (denyMode) return 'Deny with feedback'
	if (submitMode === 'queue') return 'Queue message'
	return 'Send message'
}

interface MobileInputHeaderProps {
	statusLabel?: string
	statusTone: MobileInputStatusTone
	children?: ReactNode
	contextCounter?: ReactNode
}

const MobileInputHeader: FC<MobileInputHeaderProps> = ({ statusLabel, statusTone, children, contextCounter }) => (
	<div className="flex flex-wrap items-center gap-2 pb-2">
		{statusLabel && (
			<span className={cn('text-[10px] uppercase tracking-[0.18em]', statusToneClasses[statusTone])}>
				{statusLabel}
			</span>
		)}
		{children}
		{contextCounter && <div className="ml-auto flex min-w-0 shrink items-center justify-end">{contextCounter}</div>}
	</div>
)

interface MobileInputModelPillProps {
	modelLabel: string
	onModelClick: () => void
	modelDisabled: boolean
}

const MobileInputModelPill: FC<MobileInputModelPillProps> = ({ modelLabel, onModelClick, modelDisabled }) => (
	<Button
		type="button"
		variant="outline"
		size="sm"
		className="relative h-8 max-w-[55%] gap-1 rounded-none border-muted-foreground/30 px-2 py-0 text-xs font-medium after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
		onClick={onModelClick}
		disabled={modelDisabled}
	>
		<span className="truncate">{modelLabel}</span>
		<ChevronUp className="h-3 w-3 shrink-0" />
	</Button>
)

interface MobileInputEffortPillProps {
	effortLabel?: string
	onEffortClick: () => void
	effortDisabled: boolean
}

const MobileInputEffortPill: FC<MobileInputEffortPillProps> = ({ effortLabel, onEffortClick, effortDisabled }) => (
	<Button
		type="button"
		variant="outline"
		size="sm"
		className="relative h-8 gap-1 rounded-none border-muted-foreground/30 px-2 py-0 text-xs font-medium uppercase after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
		onClick={onEffortClick}
		disabled={effortDisabled}
	>
		<span className="truncate">{effortLabel || 'EFFORT'}</span>
		<ChevronUp className="h-3 w-3 shrink-0" />
	</Button>
)

interface MobileInputFastModePillProps {
	fastModeEnabled: boolean
	onFastModeToggle: (next: boolean) => void
	fastModeDisabled: boolean
}

const MobileInputFastModePill: FC<MobileInputFastModePillProps> = ({
	fastModeEnabled,
	onFastModeToggle,
	fastModeDisabled,
}) => (
	<Button
		type="button"
		variant="outline"
		size="sm"
		className={cn(
			'relative h-8 gap-1 rounded-none border-muted-foreground/30 px-2 py-0 text-xs font-medium uppercase',
			"after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
			fastModeEnabled &&
				!fastModeDisabled &&
				'border-[var(--terminal-warning)]/35 bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)]/15 hover:text-[var(--terminal-warning)]',
		)}
		onClick={() => onFastModeToggle(!fastModeEnabled)}
		disabled={fastModeDisabled}
		aria-pressed={fastModeEnabled}
		aria-label={`Fast Mode: ${fastModeEnabled ? 'Enabled' : 'Disabled'}`}
	>
		<Zap className={cn('h-3 w-3 shrink-0', fastModeEnabled && !fastModeDisabled && 'fill-current')} />
		<span className="truncate">Fast</span>
	</Button>
)

interface MobileInputAttachmentsRowProps {
	attachments: MobileInputAttachment[]
	onRemoveAttachment?: (id: string) => void
}

const MobileInputAttachmentsRow: FC<MobileInputAttachmentsRowProps> = ({ attachments, onRemoveAttachment }) => {
	if (attachments.length === 0) return null

	return (
		<div className="flex flex-wrap items-center gap-1.5 pb-2">
			{attachments.map((attachment) => (
				<span
					key={attachment.id}
					className="inline-flex items-center gap-1 rounded-none border border-muted-foreground/30 bg-muted/40 px-1.5 py-0.5 text-xs text-foreground"
				>
					<Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
					<span className="max-w-[140px] truncate">{attachment.label}</span>
					{onRemoveAttachment && (
						<button
							type="button"
							onClick={() => onRemoveAttachment(attachment.id)}
							className="ml-0.5 -my-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:text-foreground"
							aria-label={`Remove ${attachment.label}`}
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</span>
			))}
		</div>
	)
}

interface MobileInputFooterProps {
	denyMode: boolean
	onCancelDeny?: () => void
	actionButtons?: ReactNode
	controls: MobileInputControl[]
	showCommentsButton: boolean
	commentsCount: number
	onSendComments?: () => void
	sendCommentsDisabled: boolean
	showInterruptButton: boolean
	onInterrupt?: () => void
	interruptDisabled: boolean
	onSend: () => void
	canSubmit: boolean
	submitButtonClasses: string
	submitLabel: string
	submitMode: MobileInputSubmitMode
}

const MobileInputFooter: FC<MobileInputFooterProps> = ({
	denyMode,
	onCancelDeny,
	actionButtons,
	controls,
	showCommentsButton,
	commentsCount,
	onSendComments,
	sendCommentsDisabled,
	showInterruptButton,
	onInterrupt,
	interruptDisabled,
	onSend,
	canSubmit,
	submitButtonClasses,
	submitLabel,
	submitMode,
}) => {
	const hasActionButtons = !!actionButtons
	const hasControls = controls.length > 0
	let leadingContent: ReactNode = <div className="flex-1" />
	if (denyMode && onCancelDeny) {
		leadingContent = (
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={onCancelDeny}
				className="h-8 shrink-0 rounded-none px-3 text-xs"
			>
				Cancel
			</Button>
		)
	} else if (!denyMode && hasActionButtons) {
		leadingContent = (
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{actionButtons}
			</div>
		)
	} else if (!denyMode && hasControls) {
		leadingContent = (
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{controls.map((control) => (
					<Button
						key={control.id}
						type="button"
						variant="ghost"
						size="icon"
						className={cn(
							'relative h-8 w-8 shrink-0 rounded-none border border-transparent',
							"after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
							'bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
							control.active && activeControlToneClasses[control.tone ?? 'neutral'],
						)}
						onClick={control.onClick}
						disabled={control.disabled}
						aria-label={control.label}
					>
						{control.icon}
						<span className="sr-only">{control.label}</span>
					</Button>
				))}
			</div>
		)
	}

	return (
		<div className="flex items-center justify-between gap-2 pt-2">
			{leadingContent}

			{showCommentsButton && (
				<Button
					type="button"
					onClick={onSendComments}
					disabled={sendCommentsDisabled}
					className={cn(
						'relative h-8 shrink-0 gap-1 rounded-none border px-2 text-xs shadow-none transition-colors',
						"after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
						sendCommentsDisabled ? disabledButtonClasses : accentButtonClasses,
					)}
					aria-label={`Send ${commentsCount} unresolved comment${commentsCount === 1 ? '' : 's'} & resolve`}
				>
					<MessageSquareShare className="h-3.5 w-3.5" />
					{commentsCount}
				</Button>
			)}

			{showInterruptButton && (
				<Button
					type="button"
					size="icon"
					onClick={onInterrupt}
					disabled={interruptDisabled}
					className={cn(
						'relative h-8 w-8 shrink-0 rounded-none border shadow-none transition-colors',
						"after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
						interruptDisabled ? disabledButtonClasses : errorButtonClasses,
					)}
					aria-label="Interrupt session"
					title="Interrupt (keeps your draft)"
				>
					<Square className="h-3.5 w-3.5 fill-current" />
				</Button>
			)}

			<Button
				type="button"
				size="icon"
				onClick={onSend}
				disabled={!canSubmit}
				className={cn(
					'relative h-8 w-8 shrink-0 rounded-none border shadow-none transition-colors',
					"after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
					submitButtonClasses,
				)}
				aria-label={submitLabel}
			>
				{denyMode ? (
					<MessageCircleX className="h-3.5 w-3.5" />
				) : submitMode === 'queue' ? (
					<Clock3 className="h-3.5 w-3.5" />
				) : (
					<Send className="h-3.5 w-3.5" />
				)}
			</Button>
		</div>
	)
}

/**
 * Mobile message input — textarea that grows with content, with a send button.
 * Send is triggered by tapping the send button or Cmd/Ctrl+Enter
 * (plain Enter adds a newline, matching the rest of the app's prompt inputs).
 *
 * If `modelLabel` + `onModelClick` are provided, a model-pill button renders
 * above the textarea — tapping it should open a bottom Sheet (e.g. MobileModelSelector)
 * owned by the parent page.
 */
export const MobileInput: FC<MobileInputProps> = ({
	value,
	onChange,
	onSend,
	placeholder = 'Send a message…',
	disabled = false,
	submitDisabled = false,
	modelLabel,
	onModelClick,
	modelDisabled = false,
	showEffort = false,
	effortLabel,
	onEffortClick,
	effortDisabled = false,
	showFastMode = false,
	fastModeEnabled = false,
	onFastModeToggle,
	fastModeDisabled = false,
	contextCounter,
	infoRow,
	statusLabel,
	statusTone = 'default',
	controls = EMPTY_CONTROLS,
	actionButtons,
	submitMode = 'send',
	attachments = EMPTY_ATTACHMENTS,
	onRemoveAttachment,
	pendingUploadCount = 0,
	onInterrupt,
	interruptDisabled = false,
	denyMode = false,
	onCancelDeny,
	commentsCount = 0,
	onSendComments,
	sendCommentsDisabled = false,
}) => {
	const trimmedValue = value.trim()
	// An attachment counts as content, so a file can be sent without typed text.
	// Deny feedback requires typed text (matching desktop's DENY button).
	const hasContent = trimmedValue.length > 0 || attachments.length > 0
	const canSubmit = !submitDisabled && (denyMode ? trimmedValue.length > 0 : hasContent)

	// While the session is busy (queue mode), a stop button sits next to the clock.
	const showInterruptButton = !denyMode && submitMode === 'queue' && !!onInterrupt

	// Send-comments-and-resolve affordance: only when unresolved comments exist.
	const showCommentsButton = !denyMode && !!onSendComments && commentsCount > 0
	const showModelRow = !denyMode && !!modelLabel && !!onModelClick
	const showEffortPill = !denyMode && showEffort && !!onEffortClick
	const showFastModePill = !denyMode && showFastMode && !!onFastModeToggle
	const showContextCounter = !denyMode && !!contextCounter
	const showHeaderRow = !!statusLabel || showModelRow || showEffortPill || showFastModePill || showContextCounter
	const hasInfoRow = !!infoRow && !denyMode
	const hasAttachments = attachments.length > 0 && !denyMode
	const submitButtonClasses = getSubmitButtonClasses(canSubmit, denyMode, submitMode)
	const submitLabel = getSubmitLabel(denyMode, submitMode)

	const resolvedPlaceholder = denyMode ? 'Tell Claude what to do differently (optional)…' : placeholder
	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
			e.preventDefault()
			onSend()
		}
	}

	return (
		<div className="shrink-0 border-t border-border bg-background">
			<div className="px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
				<div className={cn('border-l-2 pl-2 pr-2', statusRailClasses[statusTone])}>
					{showHeaderRow && (
						<MobileInputHeader
							statusLabel={statusLabel}
							statusTone={statusTone}
							contextCounter={showContextCounter ? contextCounter : undefined}
						>
							{!denyMode && modelLabel && onModelClick && (
								<MobileInputModelPill
									modelLabel={modelLabel}
									onModelClick={onModelClick}
									modelDisabled={modelDisabled}
								/>
							)}
							{!denyMode && showEffort && onEffortClick && (
								<MobileInputEffortPill
									effortLabel={effortLabel}
									onEffortClick={onEffortClick}
									effortDisabled={effortDisabled}
								/>
							)}
							{!denyMode && showFastMode && onFastModeToggle && (
								<MobileInputFastModePill
									fastModeEnabled={fastModeEnabled}
									onFastModeToggle={onFastModeToggle}
									fastModeDisabled={fastModeDisabled}
								/>
							)}
						</MobileInputHeader>
					)}

					{hasInfoRow && <div className="flex flex-wrap items-center gap-1.5 pb-2">{infoRow}</div>}

					{hasAttachments && (
						<MobileInputAttachmentsRow attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
					)}

					{pendingUploadCount > 0 && !denyMode && (
						<div className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
							<Loader2 className="h-3 w-3 shrink-0 animate-spin" />
							Uploading {pendingUploadCount} {pendingUploadCount === 1 ? 'file' : 'files'}…
						</div>
					)}

					<Textarea
						value={value}
						onChange={(e) => onChange(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={resolvedPlaceholder}
						disabled={disabled}
						rows={1}
						aria-label={denyMode ? 'Deny feedback' : 'Message input'}
						className={cn(
							'min-h-[56px] max-h-[160px] resize-none border-0 bg-transparent px-0 py-0 text-base leading-6 shadow-none focus-visible:ring-0',
							'rounded-none dark:bg-transparent',
							'disabled:cursor-not-allowed disabled:opacity-50',
							'overflow-y-auto',
						)}
						style={
							{ height: 'auto', fieldSizing: 'content' } as React.CSSProperties & { fieldSizing: string }
						}
					/>

					<MobileInputFooter
						denyMode={denyMode}
						onCancelDeny={onCancelDeny}
						actionButtons={actionButtons}
						controls={controls}
						showCommentsButton={showCommentsButton}
						commentsCount={commentsCount}
						onSendComments={onSendComments}
						sendCommentsDisabled={sendCommentsDisabled}
						showInterruptButton={showInterruptButton}
						onInterrupt={onInterrupt}
						interruptDisabled={interruptDisabled}
						onSend={onSend}
						canSubmit={canSubmit}
						submitButtonClasses={submitButtonClasses}
						submitLabel={submitLabel}
						submitMode={submitMode}
					/>
				</div>
			</div>
		</div>
	)
}
