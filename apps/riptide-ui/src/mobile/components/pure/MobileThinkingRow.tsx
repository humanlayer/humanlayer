import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'

function getThinkingText(event: ConversationEvent): string {
	const content = event.content ?? ''
	if (content.startsWith('<thinking>')) {
		const end = content.indexOf('</thinking>')
		const body = end === -1 ? content.slice('<thinking>'.length) : content.slice('<thinking>'.length, end)
		return body.trim()
	}
	return content.trim()
}

export interface MobileThinkingRowProps {
	event: ConversationEvent
	/** Seconds spent thinking, or null when not derivable. */
	durationSeconds: number | null
	/** True while this is the last event and the thinking may still be streaming. */
	isStreaming: boolean
	isExpanded: boolean
	onToggleExpand: () => void
}

/**
 * A single "Thinking for N seconds" line whose header matches the MobileToolGroup
 * header typography (text-xs font-medium text-muted-foreground, not italic).
 * Tapping toggles the full thinking content, which stays deliberately dimmer than
 * assistant text.
 */
export const MobileThinkingRow: FC<MobileThinkingRowProps> = ({
	event,
	durationSeconds,
	isStreaming,
	isExpanded,
	onToggleExpand,
}) => {
	// Duration suffix is trivially removable — drop the ` for … second(s)` tail to
	// get a bare "Thinking" label.
	const label =
		durationSeconds != null && durationSeconds > 0
			? `Thinking for ${durationSeconds} second${durationSeconds === 1 ? '' : 's'}`
			: isStreaming
				? 'Thinking…'
				: 'Thinking'
	const text = getThinkingText(event)

	return (
		<div className="bg-background">
			<button
				type="button"
				onClick={onToggleExpand}
				className={cn(
					'flex min-h-[44px] w-full items-center gap-2 border-0 bg-transparent px-4 text-left text-inherit cursor-pointer',
					'hover:bg-accent/5 active:bg-accent/10 transition-colors',
				)}
			>
				<ChevronDown
					className={cn(
						'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
						!isExpanded && '-rotate-90',
					)}
				/>
				<span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
			</button>

			{isExpanded && text && (
				<div className="pl-[2.1rem] pr-4 pb-3 text-xs italic text-muted-foreground/80 [&_p]:mb-1 [&_pre]:mb-1">
					<MarkdownRenderer content={text} />
				</div>
			)}
		</div>
	)
}
