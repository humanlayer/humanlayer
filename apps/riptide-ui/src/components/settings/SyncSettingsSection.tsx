import { Label } from '@humanlayer/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@humanlayer/ui/components/radio-group'
import { useSyncExternalStore } from 'react'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

export function SyncSettingsSection() {
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const setSyncForceMode = useSettingsStore((s) => s.setSyncForceMode)

	const { tracker } = useSyncInternal()

	// Subscribe to tracker mode changes for the Sync tab display
	const syncModes = useSyncExternalStore(
		(callback) => tracker.onChange((_name, _mode) => callback()),
		() => tracker.getAllModes(),
	)

	// Subscribe to offline state for per-collection offline detection
	const offlineCollections = useSyncExternalStore(
		(callback) => tracker.onOfflineChange((_name, _offline) => callback()),
		() => tracker.getOfflineCollections(),
	)

	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">
				These are advanced settings that control how Riptide queries data from the cloud. You probably
				don&apos;t want to mess with these. &quot;Degraded&quot; means your app is automatically falling back to
				polling-based sync, most often due to network issues.
			</p>
			{/* Sync Path - always user-controlled */}
			<div className="space-y-2">
				<Label className="text-sm font-medium">Sync Path</Label>
				<p className="text-sm text-muted-foreground">Dictates whether to use primary or fallback sync path.</p>
				<RadioGroup
					value={syncForceMode}
					onValueChange={(value) => setSyncForceMode(value as 'auto' | 'electric' | 'query')}
					className="flex flex-row gap-4"
				>
					<div className="flex items-center gap-2">
						<RadioGroupItem value="auto" id="sync-mode-auto" />
						<Label htmlFor="sync-mode-auto" className="text-sm font-normal cursor-pointer">
							Auto
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<RadioGroupItem value="electric" id="sync-mode-electric" />
						<Label htmlFor="sync-mode-electric" className="text-sm font-normal cursor-pointer">
							Primary
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<RadioGroupItem value="query" id="sync-mode-query" />
						<Label htmlFor="sync-mode-query" className="text-sm font-normal cursor-pointer">
							Fallback
						</Label>
					</div>
				</RadioGroup>
			</div>

			{/* Per-collection status table */}
			<div className="space-y-2">
				<Label className="text-sm font-medium">Collection Status</Label>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
					{Object.entries(syncModes).map(([name, mode]) => {
						const isOffline = offlineCollections.includes(name)
						const label = isOffline ? 'offline' : mode === 'query' ? 'degraded' : 'online'
						const colorClass = isOffline
							? 'text-destructive'
							: mode === 'query'
								? 'text-yellow-500'
								: 'text-green-500'
						return (
							<div key={name} className="flex justify-between gap-4">
								<span className="text-muted-foreground">{name}</span>
								<span className={colorClass}>{label}</span>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
