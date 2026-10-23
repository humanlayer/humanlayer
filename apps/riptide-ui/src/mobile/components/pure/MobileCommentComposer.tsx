import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { getInitials } from '@humanlayer/ui/lib/comment-utils'
import { cn } from '@humanlayer/ui/lib/utils'
import { ArrowUp } from 'lucide-react'
import { type FC, useCallback } from 'react'

import { toCommentDocJson } from '@/utils/mobile-comment-doc'

export interface MobileCommentComposerProps {
	/** Controlled value — owned by the wrapper (which may persist it as a draft). */
	value: string
	onChange: (value: string) => void
	onSubmit: (contentText: string, contentJson: string) => void
	placeholder?: string
	ariaLabel?: string
	autoFocus?: boolean
	authorDisplayName?: string
	authorAvatarUrl?: string
	className?: string
}

/**
 * Notion-style single-row comment composer: avatar, borderless growing
 * textarea (16px to avoid iOS zoom-on-focus), and a send arrow that lights
 * up once there's content. No boxes, no separators.
 */
export const MobileCommentComposer: FC<MobileCommentComposerProps> = ({
	value,
	onChange,
	onSubmit,
	placeholder = 'Reply...',
	ariaLabel = 'Comment text',
	autoFocus = false,
	authorDisplayName,
	authorAvatarUrl,
	className,
}) => {
	// Focus on mount when requested, cursor at end (callback ref, no effect)
	const focusTextarea = useCallback(
		(el: HTMLTextAreaElement | null) => {
			if (el && autoFocus) {
				el.focus()
				const len = el.value.length
				el.setSelectionRange(len, len)
			}
		},
		[autoFocus],
	)

	const canSubmit = value.trim().length > 0

	const handleSubmit = () => {
		const trimmed = value.trim()
		if (trimmed) onSubmit(trimmed, toCommentDocJson(trimmed))
	}

	return (
		<div className={cn('flex items-center gap-2', className)}>
			<Avatar className="size-5 shrink-0">
				<AvatarImage
					src={authorAvatarUrl ?? ''}
					alt={authorDisplayName ?? 'You'}
					className="absolute inset-0 object-cover"
				/>
				<AvatarFallback className="text-[8px]">{getInitials(authorDisplayName ?? 'You')}</AvatarFallback>
			</Avatar>
			<textarea
				ref={focusTextarea}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault()
						handleSubmit()
					}
				}}
				rows={1}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className="field-sizing-content min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent py-2.5 text-base placeholder:text-muted-foreground/50 focus:outline-none"
			/>
			<button
				type="button"
				onClick={handleSubmit}
				disabled={!canSubmit}
				aria-label="Comment"
				className={cn(
					'flex size-11 shrink-0 items-center justify-center transition-colors',
					canSubmit ? 'text-foreground' : 'text-muted-foreground/40',
				)}
			>
				<ArrowUp className="h-4 w-4" />
			</button>
		</div>
	)
}
