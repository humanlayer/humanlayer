import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { useState } from 'react'

import {
	retryStoppingLocalDaemon,
	turnOffLocalDaemon,
	turnOnLocalDaemon,
	useLocalDaemonPolicyStore,
} from '@/hooks/stores/localDaemonPolicyStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { LocalDaemonStopDialog } from './LocalDaemonStopDialog'

/** Desktop-only control for the daemon this app runs on this device. */
export function LocalDaemonSetting() {
	const enabled = useSettingsStore((state) => state.localDaemonEnabled)
	const stopStatus = useLocalDaemonPolicyStore((state) => state.stopStatus)
	const [confirmOpen, setConfirmOpen] = useState(false)
	const stopping = stopStatus === 'stopping'

	const changeEnabled = (next: boolean) => {
		if (next) void turnOnLocalDaemon()
		else setConfirmOpen(true)
	}

	const confirmStop = async () => {
		await turnOffLocalDaemon()
		setConfirmOpen(false)
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-6">
				<div className="space-y-1">
					<Label htmlFor="local-daemon-enabled">Local daemon</Label>
					<p id="local-daemon-description" className="text-sm text-muted-foreground">
						Run sessions on this device. Turn off to use remote hosts only.
					</p>
					<p id="local-daemon-warning" className="text-sm text-muted-foreground">
						Turning this off interrupts sessions on this device. You need an online host to run sessions.
					</p>
				</div>
				<Switch
					id="local-daemon-enabled"
					aria-describedby="local-daemon-description local-daemon-warning"
					checked={enabled}
					disabled={stopping}
					onCheckedChange={changeEnabled}
				/>
			</div>
			{stopping && !confirmOpen && (
				<p role="status" className="text-sm text-muted-foreground">
					Stopping the local daemon…
				</p>
			)}
			{stopStatus === 'failed' && !enabled && (
				<div role="alert" className="flex items-start justify-between gap-6">
					<div className="space-y-1">
						<p className="text-sm font-medium text-destructive">Could not stop the local daemon</p>
						<p className="text-sm text-muted-foreground">
							Automatic startup is off, but a local daemon may still be running. Retry stopping it.
						</p>
					</div>
					<Button variant="outline" size="sm" onClick={() => void retryStoppingLocalDaemon()}>
						Retry
					</Button>
				</div>
			)}
			<LocalDaemonStopDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={confirmStop} />
		</div>
	)
}
