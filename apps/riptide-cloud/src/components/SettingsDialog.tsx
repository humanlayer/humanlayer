import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useSyncExternalStore } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSyncInternal } from '@/providers/SyncProvider'

export function SettingsDialog() {
	const { isOpen, close, syncForceMode, setSyncForceMode } = useSettingsStore()

	const { tracker } = useSyncInternal()

	// Subscribe to tracker mode changes for the Sync tab display
	const syncModes = useSyncExternalStore(
		(callback) => tracker.onChange((_name, _mode) => callback()),
		() => tracker.getAllModes(),
	)

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
			<DialogContent
				className="sm:max-w-lg min-h-[30vh] max-h-[80vh] overflow-hidden flex flex-col"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto space-y-6 mt-4">
					{/* Global Force Mode */}
					<div className="space-y-2">
						<Label className="text-sm font-medium">Sync Mode Override</Label>
						<div className="flex items-center justify-between gap-4">
							<p className="text-sm text-muted-foreground">
								Force all collections to use a specific sync backend. Auto uses Electric SQL with
								automatic fallback to query polling on errors.
							</p>
							<Select
								value={syncForceMode}
								onValueChange={(value) => setSyncForceMode(value as 'auto' | 'electric' | 'query')}
							>
								<SelectTrigger className="w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto</SelectItem>
									<SelectItem value="electric">Force Electric</SelectItem>
									<SelectItem value="query">Force Query</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Per-collection status table */}
					<div className="space-y-2">
						<Label className="text-sm font-medium">Collection Status</Label>
						<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
							{Object.entries(syncModes).map(([name, mode]) => (
								<div key={name} className="flex justify-between gap-4">
									<span className="text-muted-foreground">{name}</span>
									<span className={mode === 'query' ? 'text-yellow-500' : 'text-green-500'}>
										{mode}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
