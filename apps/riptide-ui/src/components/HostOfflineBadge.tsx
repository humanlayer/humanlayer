import { Badge } from '@humanlayer/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

interface HostOfflineBadgeProps {
	hostName?: string | null
	className?: string
	action: ReactNode
}

export function HostOfflineBadge({ hostName, className, action }: HostOfflineBadgeProps) {
	return (
		<div className="flex items-center gap-2">
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge variant="destructive" className={cn('font-mono text-xs gap-1', className)}>
						<WifiOff className="h-3 w-3" />
						HOST OFFLINE
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="font-mono text-xs">
					<p>
						{hostName
							? `The daemon on "${hostName}" is not running.`
							: 'The daemon for this session is not running.'}
					</p>
					<p className="text-muted-foreground mt-1">Start the daemon to continue this session.</p>
				</TooltipContent>
			</Tooltip>
			{action}
		</div>
	)
}
