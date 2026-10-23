import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { useLocalStorage } from '@uidotdev/usehooks'
import { Check, ChevronDown, MessageSquareShare } from 'lucide-react'
import { useCallback } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSelectedArtifactCommentActions } from '@/hooks/useSelectedArtifactCommentActions'

const SEND_COMMENTS_MODE_KEY = 'riptide-send-comments-mode'
type SendCommentsMode = 'send' | 'send-and-resolve'

export interface SendCommentsSplitButtonProps {
	disabled: boolean
	isNarrow: boolean
	hidden: boolean
	className?: string
	/** Current text in the editor (will be prepended to comments) */
	editorText: string
	/** Called to submit the combined message */
	onSubmit: (text: string) => void
	/** Called to clear the editor after submit */
	onClearEditor: () => void
}

export function SendCommentsSplitButton({
	disabled,
	isNarrow,
	hidden,
	className,
	editorText,
	onSubmit,
	onClearEditor,
}: SendCommentsSplitButtonProps) {
	const {
		getFormattedComments,
		getFormattedCommentsWithResolvedNote,
		resolveAllComments,
		unresolvedCount,
		canSendAll,
	} = useSelectedArtifactCommentActions()
	const [mode, setMode] = useLocalStorage<SendCommentsMode>(SEND_COMMENTS_MODE_KEY, 'send-and-resolve')

	const handleSendComments = useCallback(() => {
		const formatted = getFormattedComments()
		if (!formatted) return

		const message = editorText.trim() ? `${editorText.trim()}\n\n${formatted}` : formatted
		onSubmit(message)
		onClearEditor()
	}, [getFormattedComments, editorText, onSubmit, onClearEditor])

	const handleSendAndResolve = useCallback(() => {
		const formatted = getFormattedCommentsWithResolvedNote()
		if (!formatted) return

		const message = editorText.trim() ? `${editorText.trim()}\n\n${formatted}` : formatted
		onSubmit(message)
		resolveAllComments()
		onClearEditor()
	}, [getFormattedCommentsWithResolvedNote, editorText, onSubmit, resolveAllComments, onClearEditor])

	const primaryAction = mode === 'send' ? handleSendComments : handleSendAndResolve

	// Register ⌥+C hotkey
	useHotkeys(
		'alt+c',
		(e) => {
			e.preventDefault()
			if (!disabled && canSendAll && unresolvedCount > 0) {
				primaryAction()
			}
		},
		{
			scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
			enabled: !hidden && !disabled && canSendAll && unresolvedCount > 0,
		},
		[primaryAction, disabled, canSendAll, unresolvedCount, hidden],
	)

	if (hidden || unresolvedCount === 0 || !canSendAll) return null

	const primaryLabel = 'Send Comments'

	const handleSelectSend = () => {
		setMode('send')
		handleSendComments()
	}

	const handleSelectSendAndResolve = () => {
		setMode('send-and-resolve')
		handleSendAndResolve()
	}

	return (
		<div role="group" aria-label="Send comments actions" className={cn('flex items-stretch', className)}>
			<Button
				variant="default"
				disabled={disabled}
				onClick={primaryAction}
				aria-label={`${primaryLabel}: ${unresolvedCount} unresolved ${unresolvedCount === 1 ? 'comment' : 'comments'}`}
				className="h-auto py-0.5 px-2 text-xs"
			>
				<MessageSquareShare className={cn('h-3 w-3', !isNarrow && 'mr-1')} />
				{!isNarrow && (
					<>
						{primaryLabel}
						<span className="ml-1 opacity-70">({unresolvedCount})</span>
					</>
				)}
				{!isNarrow && (
					<KeyboardShortcut size="xs" className="ml-1">
						⌥+C
					</KeyboardShortcut>
				)}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="default"
						disabled={disabled}
						aria-label="More send comments options"
						className="h-auto py-0.5 px-1.5 text-xs border-l-0"
					>
						<ChevronDown className="h-3 w-3" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-[260px]">
					<DropdownMenuItem
						onSelect={handleSelectSend}
						className="flex items-center justify-between focus:[&_svg]:!text-background"
					>
						<div className="flex items-center gap-2">
							<MessageSquareShare className="h-3.5 w-3.5" />
							<span>Send all Comments to Agent</span>
						</div>
						{mode === 'send' && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={handleSelectSendAndResolve}
						className="flex items-center justify-between focus:[&_svg]:!text-background"
					>
						<div className="flex items-center gap-2">
							<MessageSquareShare className="h-3.5 w-3.5" />
							<span>Send all Comments to Agent & Resolve</span>
						</div>
						{mode === 'send-and-resolve' && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
