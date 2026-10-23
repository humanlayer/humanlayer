import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { X } from 'lucide-react'

interface ContextWarningBannerProps {
	onDismiss: () => void
}

export function ContextWarningBanner({ onDismiss }: ContextWarningBannerProps) {
	return (
		<span className="font-mono text-xs uppercase tracking-wider text-[var(--terminal-warning)] flex items-center gap-1">
			Context window is filling up. Continue in a new session for best results.
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="h-5 px-1 border border-transparent text-[var(--terminal-warning)] hover:text-[var(--terminal-warning)] hover:bg-[color-mix(in_srgb,var(--terminal-warning)_15%,transparent)] hover:border-[var(--terminal-warning)]"
						onClick={onDismiss}
						aria-label="Dismiss"
					>
						<X className="h-3 w-3" />
					</Button>
				</TooltipTrigger>
				<TooltipContent
					className="bg-[var(--terminal-warning)] text-black"
					arrowClassName="bg-[var(--terminal-warning)] fill-[var(--terminal-warning)]"
				>
					<p>Hide in all sessions for 7 days</p>
				</TooltipContent>
			</Tooltip>
		</span>
	)
}
