import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { ScrollArea } from '@humanlayer/ui/components/scroll-area'

import type { LaunchDaemonState } from '@/hooks/use-launch-daemon'

interface LaunchDaemonModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	state: LaunchDaemonState
	onLaunch: () => void
	onReset: () => void
	canLaunch: boolean
	isRunning: boolean
}

const STATUS_LABELS: Record<LaunchDaemonState['status'], string> = {
	idle: 'Idle',
	starting: 'Starting daemon',
	'waiting-for-host': 'Waiting for host',
	success: 'Daemon online',
	error: 'Launch failed',
}

export function LaunchDaemonModal({
	open,
	onOpenChange,
	state,
	onLaunch,
	onReset,
	canLaunch,
	isRunning,
}: LaunchDaemonModalProps) {
	const outputText = state.outputLines.join('\n')
	const launchLabel = state.status === 'idle' ? 'Launch daemon' : 'Relaunch daemon'
	const launchDisabled = !canLaunch || isRunning
	const isError = state.status === 'error'

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[90vw] max-w-[90vw] h-[85vh] p-0 sm:max-w-[90vw] flex flex-col overflow-hidden">
				<DialogHeader className="px-4 py-3 border-b">
					<DialogTitle>Launch Local Daemon</DialogTitle>
				</DialogHeader>

				<div className="px-4 py-3 border-b flex items-center justify-between gap-3">
					<Badge variant={isError ? 'destructive' : 'outline'}>{STATUS_LABELS[state.status]}</Badge>
					<div className="flex items-center gap-2">
						{state.status !== 'idle' && (
							<Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={isRunning}>
								Reset
							</Button>
						)}
						<Button type="button" onClick={onLaunch} disabled={launchDisabled}>
							{launchLabel}
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-hidden">
					<ScrollArea className="h-full">
						<pre className="font-mono text-xs whitespace-pre-wrap break-words px-4 py-3">
							{outputText || 'No daemon launch output yet.'}
						</pre>
					</ScrollArea>
				</div>

				{state.errorMessage && (
					<div className="px-4 py-3 border-t text-destructive font-mono text-xs">{state.errorMessage}</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
