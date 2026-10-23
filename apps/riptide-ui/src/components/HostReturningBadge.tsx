import { Badge } from '@humanlayer/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { Loader2 } from 'lucide-react'

type ReturningHostState = 'starting' | 'updating'

const BADGE_LABELS: Record<ReturningHostState, string> = {
	starting: 'Host starting…',
	updating: 'Host updating…',
}

const RUN_WHEN: Record<ReturningHostState, string> = {
	starting: "Messages you send now run when it's online.",
	updating: "Messages you send now run when it's back.",
}

interface HostReturningBadgeProps {
	hostName?: string | null
	state: ReturningHostState
	className?: string
}

export function HostReturningBadge({ hostName, state, className }: HostReturningBadgeProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="secondary" className={cn('font-mono text-xs gap-1', className)}>
					<Loader2 className="h-3 w-3 animate-spin" />
					{BADGE_LABELS[state]}
				</Badge>
			</TooltipTrigger>
			<TooltipContent className="font-mono text-xs">
				<p>
					{hostName ? `The daemon on "${hostName}" is ${state}.` : `The daemon for this session is ${state}.`}
				</p>
				<p className="text-muted-foreground mt-1">{RUN_WHEN[state]}</p>
			</TooltipContent>
		</Tooltip>
	)
}
