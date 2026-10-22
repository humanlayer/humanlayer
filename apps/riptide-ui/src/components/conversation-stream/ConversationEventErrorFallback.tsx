import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { formatCompactRelativeTime } from '@humanlayer/ui/lib/time-format'
import { AlertTriangle } from 'lucide-react'
import type { FC } from 'react'

export interface ConversationEventErrorFallbackProps {
	error: Error
	event?: Partial<ConversationEvent>
}

/**
 * Full error row replacing the entire ConversationEventRow when content fails to render.
 * Renders its own row chrome with AlertTriangle icon and red-tinted background.
 */
export const ConversationEventErrorFallback: FC<ConversationEventErrorFallbackProps> = ({ error, event }) => {
	const toolName = event?.toolName
	const contextLabel = toolName || (event?.eventType ? `${event.eventType} event` : 'Event')

	return (
		<div className="group p-4 transition-colors duration-200 border-l-2 border-l-[var(--terminal-error)] bg-[var(--terminal-error)]/10">
			<div className="flex items-start gap-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2">
						<span className="text-sm align-middle relative top-[1px]">
							<AlertTriangle className="w-4 h-4 text-[var(--terminal-error)]" />
						</span>
						<div className="flex-1 min-w-0 space-y-1">
							<div className="flex items-baseline gap-2">
								<span className="text-sm font-semibold text-[var(--terminal-error)]">
									{contextLabel}
								</span>
								<span className="text-sm text-[var(--terminal-error)]">failed to render</span>
							</div>
							<div className="text-sm text-[var(--terminal-error)] font-mono flex items-start gap-1">
								<span className="text-[var(--terminal-error)]/50">⎿</span>
								<span className="break-all">{error.message}</span>
							</div>
						</div>
					</div>
				</div>
				{event?.createdAt && (
					<div className="flex items-center gap-2 flex-shrink-0">
						<span className="text-xs text-muted-foreground/60">
							{formatCompactRelativeTime(event.createdAt)}
						</span>
					</div>
				)}
			</div>
		</div>
	)
}
