import type { ClaudeUsageLimits } from '@humanlayer/schemas/zod/host/usage-limits'
import { ArrowUp, Square, X } from 'lucide-react'
import { type ReactNode, type RefObject, useRef, useState } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useViewportFileDrop } from '@/hooks/useViewportFileDrop'
import { AddButton, AttachmentChips, ContextMeter } from '@/minimalist/components/ComposerControls'
import { ModelPicker, PermissionPicker } from '@/minimalist/components/ModelPicker'
import { SuggestionList, useSuggestions } from '@/minimalist/components/Suggestions'
import type { SlashCommand } from '@/minimalist/lib/data'
import type { MentionScope } from '@/minimalist/lib/mentions'
import type { ComposerSettings, ModelCatalog, ModelOption } from '@/minimalist/lib/models'
import type { ContextUsage } from '@/minimalist/lib/send'
import { enterAction } from '@/minimalist/lib/send-keys'
import type { TicketProvider } from '@/minimalist/lib/tickets'
import type { ComposerAttachments } from '@/minimalist/lib/use-attachments'

/**
 * The one input in the app. On the home screen it launches a task; in a session it sends,
 * queues while the agent runs, or carries denial feedback when an approval is being refused.
 * Children sit above the input, such as the new-task page's project and host strip.
 */
export function Composer({
	value,
	onChange,
	onSubmit,
	onStop,
	onInterruptAndSend,
	onCompact,
	placeholder,
	running = false,
	disabled = false,
	submitDisabled = false,
	submitLabel,
	settings,
	onSettingsChange,
	catalog,
	onHandoff,
	handoffBlocked,
	context,
	chip,
	autoFocus,
	commands = [],
	attachments,
	inputRef,
	usage,
	mentionScope,
	onAddIssue,
	hasIssue = false,
	multiplayer,
	promptInput,
	children,
}: {
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
	onStop?: () => void
	onInterruptAndSend?: () => void
	/** Sends /compact; the context meter offers it once the window fills up. */
	onCompact?: () => void
	placeholder: string
	running?: boolean
	disabled?: boolean
	submitDisabled?: boolean
	submitLabel?: string
	settings: ComposerSettings
	onSettingsChange: (settings: ComposerSettings) => void
	catalog: ModelCatalog
	/** In a session: picking another agent's model hands the conversation off to it. */
	onHandoff?: (model: ModelOption) => void
	handoffBlocked?: string | null
	context?: ContextUsage | null
	chip?: { label: string; onClear: () => void }
	autoFocus?: boolean
	/** Bundled skills and discovered host commands; `/` opens a menu of them. */
	commands?: SlashCommand[]
	attachments?: ComposerAttachments
	inputRef?: RefObject<HTMLTextAreaElement | null>
	/** The chosen host's Claude usage; the model pill shows it once it matters. */
	usage?: { hostName: string; limits: ClaudeUsageLimits | null | undefined }
	/** `@` offers the task's documents, plus files when this machine runs the host. */
	mentionScope?: MentionScope
	/** Offers Linear, GitHub and Jira issues in the + menu; the new-task page attaches the one you pick. */
	onAddIssue?: (provider: TicketProvider) => void
	/** An attached issue is enough to send, even with nothing typed. */
	hasIssue?: boolean
	multiplayer?: { active: boolean; detail: string; disabled: boolean; onSelect: () => void }
	promptInput?: ReactNode
	children?: ReactNode
}) {
	const sendKey = useSettingsStore((state) => state.sendMessageKeybinding)
	// Esc once arms the stop; a second Esc within a moment stops the agent, so a stray key never interrupts work.
	const [stopArmed, setStopArmed] = useState(false)
	const canSend =
		(value.trim().length > 0 || (attachments?.metadata.length ?? 0) > 0 || hasIssue) &&
		!disabled &&
		!submitDisabled &&
		!attachments?.blocked
	const ownRef = useRef<HTMLTextAreaElement>(null)
	const textarea = inputRef ?? ownRef
	const suggestions = useSuggestions({ value, onChange, commands, mentionScope, textarea })
	// A file dropped anywhere in the window attaches here, including the desktop app's native drops.
	useViewportFileDrop(attachments && !disabled ? attachments.add : null)

	return (
		<div className="composer-wrap" role="group" aria-label="Message composer">
			{children}
			<SuggestionList suggestions={suggestions} />
			<div className={chip ? 'composer has-chip' : 'composer'}>
				{attachments ? <AttachmentChips attachments={attachments} disabled={disabled} /> : null}
				{promptInput ?? (
					<textarea
						ref={textarea}
						aria-label="Message the agent"
						{...suggestions.ariaProps}
						value={value}
						placeholder={placeholder}
						disabled={disabled}
						autoFocus={autoFocus}
						rows={Math.min(10, Math.max(2, value.split('\n').length))}
						onChange={(event) => {
							onChange(event.target.value)
							suggestions.edited(event.target.selectionStart)
						}}
						onSelect={(event) => suggestions.moved(event.currentTarget.selectionStart)}
						onPaste={(event) => {
							if (attachments && event.clipboardData.files.length > 0) {
								event.preventDefault()
								attachments.add(Array.from(event.clipboardData.files))
							}
						}}
						onKeyDown={(event) => {
							if (suggestions.onKeyDown(event)) return
							if (event.key === 'Escape' && running && onStop) {
								event.preventDefault()
								if (stopArmed) {
									setStopArmed(false)
									onStop()
								} else {
									setStopArmed(true)
									setTimeout(() => setStopArmed(false), 1500)
								}
								return
							}
							const action = enterAction(event, sendKey, Boolean(running && onInterruptAndSend))
							if (!action) return
							event.preventDefault()
							if (!canSend) return
							if (action === 'interrupt') onInterruptAndSend?.()
							else onSubmit()
						}}
					/>
				)}
				<div className="bar">
					{attachments || multiplayer ? (
						<AddButton
							attachments={attachments}
							disabled={disabled}
							onAddIssue={onAddIssue}
							multiplayer={multiplayer}
						/>
					) : null}
					{chip ? (
						<span className="pill chip">
							<X className="i sm" />
							{chip.label}
							<button type="button" className="muted" onClick={chip.onClear}>
								Cancel
							</button>
						</span>
					) : (
						<>
							<PermissionPicker
								settings={settings}
								onSettingsChange={onSettingsChange}
								autoMode={
									catalog.models.find((model) => model.value === settings.model)?.autoMode ?? true
								}
							/>
							<ContextMeter usage={context} running={running} disabled={disabled} onCompact={onCompact} />
						</>
					)}
					<span className="sp" />
					{stopArmed && running ? (
						<span className="muted stop-hint" role="status">
							Press Esc again to stop
						</span>
					) : null}
					<ModelPicker
						settings={settings}
						onSettingsChange={onSettingsChange}
						catalog={catalog}
						usage={usage}
						onHandoff={onHandoff}
						handoffBlocked={handoffBlocked}
					/>
					{running && onStop && !canSend ? (
						<button
							type="button"
							className="send"
							title="Stop the agent"
							aria-label="Stop"
							onClick={onStop}
							disabled={disabled}
						>
							<Square className="i sm" fill="currentColor" />
						</button>
					) : null}
					{running && onInterruptAndSend && canSend ? (
						<button
							type="button"
							className="btn ghost"
							title={`Stop the agent and send this now (${sendKey === 'enter' ? '⌘ Enter' : '⇧⌘ Enter'})`}
							onClick={onInterruptAndSend}
						>
							Send now
						</button>
					) : null}
					{running && !canSend ? null : (
						<button
							type="button"
							className={running ? 'btn primary' : 'send'}
							title={running ? 'Queue. It sends when the agent finishes.' : (submitLabel ?? 'Send')}
							aria-label={submitLabel ?? 'Send'}
							disabled={!canSend}
							onClick={onSubmit}
						>
							{running ? 'Queue' : <ArrowUp className="i sm" />}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
