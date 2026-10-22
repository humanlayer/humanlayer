import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { MessageSquare, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { Button } from './button'
import { KeyboardShortcut } from './keyboard-shortcut'
import { getInitials } from '../lib/comment-utils'
import { TooltipContent } from './tooltip'

/**
 * Icon convention for comment UI, in this file and everywhere comments are shown:
 * `MessageSquare*` records a comment, `MessageSquareShare` delivers recorded
 * comments to the agent, and the `Send` paper plane is reserved for composers
 * that hand a message straight to the agent (session composer and friends).
 * A submit button here never sends anything to the agent, so it never uses `Send`.
 */
interface CommentEditorProps {
	/** Controlled value — owned by the wrapper (which holds the draft). */
	value: string
	/** Called on every keystroke; the wrapper persists the draft. */
	onChange: (value: string) => void
	onSubmit: (contentText: string, contentJson: string) => void
	placeholder?: string
	autoFocus?: boolean
	/** Soft close (Escape) — draft is kept by the wrapper. */
	onCancel?: () => void
	/** Explicit discard (✕ button) — wrapper bundles clear() + close. */
	onDiscard?: () => void
	/** Renders the ✕ button (tooltip "Discard"). */
	showDiscard?: boolean
	currentUserDisplayName?: string
	currentUserAvatarUrl?: string
	variant?: 'default' | 'inline-reply' | 'inline-edit' | 'block-comment'
	disabled?: boolean
	error?: string | null
}

export function CommentEditor({
	value,
	onChange,
	onSubmit,
	placeholder = 'Reply...',
	autoFocus = false,
	onCancel,
	onDiscard,
	showDiscard = false,
	currentUserDisplayName,
	currentUserAvatarUrl,
	variant = 'default',
	disabled = false,
	error,
}: CommentEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const textarea = textareaRef.current
		if (autoFocus && textarea) {
			textarea.focus()
			// A restored draft should continue where it left off, not at the start.
			const len = textarea.value.length
			textarea.setSelectionRange(len, len)
		}
	}, [autoFocus])

	// Capture-phase Escape handler to intercept before useHotkeys bubbling-phase listeners
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			const textarea = textareaRef.current
			if (e.key === 'Escape' && !disabled && textarea && textarea === document.activeElement) {
				e.stopImmediatePropagation()
				e.preventDefault()
				textarea.blur()
				onCancel?.()
			}
		}
		document.addEventListener('keydown', handleEscape, { capture: true })
		return () => document.removeEventListener('keydown', handleEscape, { capture: true })
	}, [disabled, onCancel])

	const handleSubmit = () => {
		const trimmed = value.trim()
		if (trimmed && !disabled) {
			// The wrapper clears the draft (and resets its own value) on submit.
			onSubmit(trimmed, JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }] }))
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			handleSubmit()
		}
	}
	const displayName = currentUserDisplayName || 'You'

	if (variant === 'inline-edit') {
		return (
			<div className="artifact-viewer-v2-comment-edit-form">
				<textarea
					ref={textareaRef}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={handleKeyDown}
					aria-label="Edit comment"
					rows={3}
					disabled={disabled}
					className="artifact-viewer-v2-comment-edit-textarea"
				/>
				{error ? (
					<p className="artifact-viewer-v2-comment-edit-error" role="alert">
						{error}
					</p>
				) : null}
				<div className="artifact-viewer-v2-comment-edit-actions">
					<Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSubmit} disabled={disabled || value.trim() === ''}>
						{disabled ? 'Saving' : 'Save'}
					</Button>
				</div>
			</div>
		)
	}

	if (variant === 'inline-reply') {
		return (
			<div className="artifact-viewer-v2-inline-reply-editor">
				<div className="artifact-viewer-v2-inline-reply-input">
					<Avatar className="mt-1 size-6 shrink-0 self-start">
						<AvatarImage src={currentUserAvatarUrl} alt={displayName} />
						<AvatarFallback className="text-[9px]">{getInitials(displayName)}</AvatarFallback>
					</Avatar>
					<textarea
						ref={textareaRef}
						value={value}
						onChange={(e) => onChange(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						rows={1}
						className="artifact-viewer-v2-inline-reply-textarea"
					/>
				</div>
				<div className="artifact-viewer-v2-inline-reply-actions">
					{value.trim() !== '' ? (
						<span className="mr-auto text-[10px] italic text-muted-foreground/50">draft saved</span>
					) : null}
					{showDiscard && onDiscard && (
						<TooltipPrimitive.Provider delayDuration={400}>
							<TooltipPrimitive.Root>
								<TooltipPrimitive.Trigger asChild>
									<Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onDiscard}>
										<X className="h-3 w-3" />
									</Button>
								</TooltipPrimitive.Trigger>
								<TooltipContent side="bottom">
									<p>Discard</p>
								</TooltipContent>
							</TooltipPrimitive.Root>
						</TooltipPrimitive.Provider>
					)}
					<Button
						size="sm"
						onClick={handleSubmit}
						disabled={disabled || value.trim() === ''}
					>
						<MessageSquare className="h-3.5 w-3.5" />
						Reply
						<KeyboardShortcut size="xs" className="ml-1">
							⌘+Enter
						</KeyboardShortcut>
					</Button>
				</div>
			</div>
		)
	}

	if (variant === 'block-comment') {
		return (
			<div className="p-3">
				<textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					rows={3}
					className="min-w-0 w-full resize-none bg-transparent px-2 py-1 text-sm placeholder:text-muted-foreground/40 focus:outline-none field-sizing-content overflow-y-auto min-h-[4.5rem]"
				/>
				<div className="mt-2 flex items-center justify-between">
					{value.trim() !== '' && (
						<span className="text-[10px] italic text-muted-foreground/50">draft saved</span>
					)}
					<Button className="ml-auto" size="sm" disabled={disabled || value.trim() === ''} onClick={handleSubmit}>
						<MessageSquare className="h-3.5 w-3.5" />
						Comment
						<KeyboardShortcut size="xs" className="ml-1">
							⌘+Enter
						</KeyboardShortcut>
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="p-3">
			<div className="flex items-center gap-2 mb-3">
				<span className="text-sm font-medium truncate">{displayName}</span>
				{value.trim() !== '' && (
					<span className="text-[10px] italic text-muted-foreground/50 shrink-0">draft saved</span>
				)}
				{showDiscard && onDiscard && (
					<TooltipPrimitive.Provider delayDuration={400}>
						<TooltipPrimitive.Root>
							<TooltipPrimitive.Trigger asChild>
								<Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 ml-auto" onClick={onDiscard}>
									<X className="h-3 w-3" />
								</Button>
							</TooltipPrimitive.Trigger>
							<TooltipContent side="bottom">
								<p>Discard</p>
							</TooltipContent>
						</TooltipPrimitive.Root>
					</TooltipPrimitive.Provider>
				)}
			</div>
			<div className="flex items-end gap-1.5">
				<textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					rows={3}
					className="min-w-0 flex-1 resize-none border border-input bg-background px-2 py-1 text-sm placeholder:text-muted-foreground/40 focus:outline-none field-sizing-content overflow-y-auto min-h-[4.5rem]"
				/>
				<TooltipPrimitive.Provider delayDuration={400}>
					<TooltipPrimitive.Root>
						<TooltipPrimitive.Trigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 shrink-0 mb-[2px]"
								aria-label="Comment"
								onClick={handleSubmit}
							>
								<MessageSquare className="h-3.5 w-3.5" />
							</Button>
						</TooltipPrimitive.Trigger>
						<TooltipContent side="bottom">
							<p className="flex items-center gap-1">
								Comment <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
							</p>
						</TooltipContent>
					</TooltipPrimitive.Root>
				</TooltipPrimitive.Provider>
			</div>
		</div>
	)
}
