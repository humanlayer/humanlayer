import { cn } from '@humanlayer/ui/lib/utils'
import { CloudOff, Loader2 } from 'lucide-react'

import type { HostState } from '@/lib/host-state'

export interface LauncherHostStateNoticeProps {
	state: HostState
	message: string
}

export function LauncherHostStateNotice({ state, message }: LauncherHostStateNoticeProps) {
	const isUnreachable = state === 'offline' || state === 'removed'
	return (
		<div
			role="status"
			data-host-state={state}
			className={cn(
				'mt-2 flex items-center gap-2 px-1 text-xs',
				isUnreachable ? 'text-[var(--terminal-warning)]' : 'text-foreground',
			)}
		>
			{isUnreachable ? (
				<CloudOff aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-warning)]" />
			) : (
				<Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-[var(--terminal-warning)]" />
			)}
			<p>{message}</p>
		</div>
	)
}
