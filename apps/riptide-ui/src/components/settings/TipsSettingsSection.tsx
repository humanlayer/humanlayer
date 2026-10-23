import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { useLocalStorage } from '@uidotdev/usehooks'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { DISMISSED_TIP_TYPES_KEY, ITERATE_DIALOG_SILENCED_KEY, TIPS_SILENCED_KEY } from '@/lib/preferences'

export function TipsSettingsSection() {
	const bypassNudgeSilenced = useSettingsStore((s) => s.bypassNudgeSilenced)
	const setBypassNudgeSilenced = useSettingsStore((s) => s.setBypassNudgeSilenced)
	const fastModeWarningAcknowledged = useSettingsStore((s) => s.fastModeWarningAcknowledged)
	const setFastModeWarningAcknowledged = useSettingsStore((s) => s.setFastModeWarningAcknowledged)
	const confirmBeforeInterruptingSubAgents = useSettingsStore((s) => s.confirmBeforeInterruptingSubAgents)
	const setConfirmBeforeInterruptingSubAgents = useSettingsStore((s) => s.setConfirmBeforeInterruptingSubAgents)

	const [tipsSilenced, setTipsSilenced] = useLocalStorage<boolean>(TIPS_SILENCED_KEY, false)
	const [dismissedTipTypes, setDismissedTipTypes] = useLocalStorage<string[]>(DISMISSED_TIP_TYPES_KEY, [])
	const [iterateDialogSilenced, setIterateDialogSilenced] = useLocalStorage<boolean>(
		ITERATE_DIALOG_SILENCED_KEY,
		false,
	)
	const largeWorkspaceAlwaysAllow = useWorkspacePreferencesStore((s) => s.largeWorkspaceAlwaysAllow)
	const setLargeWorkspaceAlwaysAllow = useWorkspacePreferencesStore((s) => s.setLargeWorkspaceAlwaysAllow)

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label className="text-sm font-medium">Show Phase Tips</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Auto-focus the Tips sidebar tab when RPI workflow phases are active.
					</p>
					<Switch checked={!tipsSilenced} onCheckedChange={(checked) => setTipsSilenced(!checked)} />
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Show Iterate Confirmation Dialog</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Show a confirmation dialog before launching iterate sessions from the context warning button.
					</p>
					<Switch
						checked={!iterateDialogSilenced}
						onCheckedChange={(checked) => setIterateDialogSilenced(!checked)}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Show Bypass Permissions Nudge</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Suggest enabling bypass permissions after multiple tool call approvals.
					</p>
					<Switch
						checked={!bypassNudgeSilenced}
						onCheckedChange={(checked) => setBypassNudgeSilenced(!checked)}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Show Fast Mode Warning</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Warn about priority-tier usage charges before enabling Fast Mode.
					</p>
					<Switch
						checked={!fastModeWarningAcknowledged}
						onCheckedChange={(checked) => setFastModeWarningAcknowledged(!checked)}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Confirm Before Interrupting Sub-Agents</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Show a confirmation dialog before interrupting sessions with running sub-agents.
					</p>
					<Switch
						checked={confirmBeforeInterruptingSubAgents}
						onCheckedChange={setConfirmBeforeInterruptingSubAgents}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Reset Tips Display Preferences</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						Tips sidebar tabs will be restored and will appear until dismissed again.
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setDismissedTipTypes([])
							setIterateDialogSilenced(false)
							setBypassNudgeSilenced(false)
							setFastModeWarningAcknowledged(false)
							toast.success('Tips display preferences reset')
						}}
						disabled={
							dismissedTipTypes.length === 0 &&
							!iterateDialogSilenced &&
							!bypassNudgeSilenced &&
							!fastModeWarningAcknowledged
						}
					>
						Reset
					</Button>
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-sm font-medium">Always Allow Large Workspace Setup</Label>
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						When enabled, worktree-now setup skips the large-workspace confirmation dialog (shown when a
						workspace has more than 5 repos).
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setLargeWorkspaceAlwaysAllow(false)
							toast.success('Large workspace preference reset')
						}}
						disabled={!largeWorkspaceAlwaysAllow}
					>
						Reset
					</Button>
				</div>
			</div>
		</div>
	)
}
