import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { HostUpdateState } from '@/lib/host-update'

import { HostUpdateConfirmDialog } from './HostUpdateConfirmDialog'

type HostUpdateControlProps = {
	updateState: HostUpdateState
	updatable: boolean
	targetDaemonVersion: string | null
	updateError: string | null
	installCommand: string
	isRequesting: boolean
	activeSessionCount: number
	oldSelfUpdater: boolean
	onRequestUpdate: () => void
}

export function HostUpdateControl({
	updateState,
	updatable,
	targetDaemonVersion,
	updateError,
	installCommand,
	isRequesting,
	activeSessionCount,
	oldSelfUpdater,
	onRequestUpdate,
}: HostUpdateControlProps) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [confirmOpen, setConfirmOpen] = useState(false)

	const requestUpdate = () => {
		if (activeSessionCount > 0 || oldSelfUpdater) setConfirmOpen(true)
		else onRequestUpdate()
	}

	const confirmDialog = targetDaemonVersion && (
		<HostUpdateConfirmDialog
			open={confirmOpen}
			targetDaemonVersion={targetDaemonVersion}
			activeSessionCount={activeSessionCount}
			oldSelfUpdater={oldSelfUpdater}
			onOpenChange={setConfirmOpen}
			onConfirm={onRequestUpdate}
		/>
	)

	const copyInstallCommand = () => {
		void copyToClipboard(installCommand)
		toast.success('Copied to clipboard')
	}

	if (updateState === 'requested' || updateState === 'installing') {
		return <span className="text-xs text-muted-foreground">Updating…</span>
	}

	if (updateState === 'failed') {
		return (
			<div className="flex items-center gap-2">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="text-xs font-medium text-red-600">Update failed</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs break-words">
						{updateError ?? 'The daemon gave no reason.'}
					</TooltipContent>
				</Tooltip>
				{updatable && targetDaemonVersion && (
					<Button variant="outline" size="sm" className="h-7" disabled={isRequesting} onClick={requestUpdate}>
						Retry
					</Button>
				)}
				{confirmDialog}
			</div>
		)
	}

	if (updateState !== 'outdated') return null

	if (updatable && targetDaemonVersion) {
		return (
			<>
				<Button variant="outline" size="sm" className="h-7" disabled={isRequesting} onClick={requestUpdate}>
					Update to {targetDaemonVersion}
				</Button>
				{confirmDialog}
			</>
		)
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Badge variant="outline" className="cursor-pointer">
					Outdated
				</Badge>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 space-y-2">
				<p className="text-xs text-muted-foreground">
					The app cannot update this daemon. Run the install command on the host, then start the daemon again.
				</p>
				<div className="bg-muted/50 rounded-md p-2 font-mono text-xs break-all relative">
					{installCommand}
					<Button
						variant="ghost"
						size="icon"
						aria-label="Copy install command"
						className="absolute top-1 right-1 h-6 w-6"
						onClick={copyInstallCommand}
					>
						<Copy className="h-3 w-3" />
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
