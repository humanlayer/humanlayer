import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

export function MinimalistUiSetting() {
	const enabled = useSettingsStore((state) => state.minimalistUiEnabled)
	const setEnabled = useSettingsStore((state) => state.setMinimalistUiEnabled)
	return (
		<div className="flex items-center justify-between gap-6">
			<div className="space-y-1">
				<Label htmlFor="minimalist-ui-enabled">Minimalist interface</Label>
				<p id="minimalist-ui-description" className="text-sm text-muted-foreground">
					Use a simpler layout on this device with the same tasks and sessions. Turn it off here to return to
					the standard interface.
				</p>
			</div>
			<Switch
				id="minimalist-ui-enabled"
				aria-describedby="minimalist-ui-description"
				checked={enabled}
				onCheckedChange={setEnabled}
			/>
		</div>
	)
}
