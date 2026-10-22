import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'

import { type ArchiveKeybinding, type SendMessageKeybinding, useSettingsStore } from '@/hooks/stores/settingsStore'
import { resolveKeybindingDisplay, shortcutKeycaps } from '@/hotkeysCatalog'

function formatKeybindingOption(binding: ArchiveKeybinding | SendMessageKeybinding): string {
	return shortcutKeycaps(resolveKeybindingDisplay(binding)).join(' ')
}

/**
 * Device-only keybinding choices. Values write straight to the persisted
 * settings store; there is no server call. Option labels show the
 * platform-primary modifier (`mod` renders as ⌘ on Apple platforms and Ctrl
 * elsewhere), matching the keycap conventions in `hotkeysCatalog.ts`.
 */
export function KeybindingsSettingsSection() {
	const archiveKeybinding = useSettingsStore((s) => s.archiveKeybinding)
	const setArchiveKeybinding = useSettingsStore((s) => s.setArchiveKeybinding)
	const sendMessageKeybinding = useSettingsStore((s) => s.sendMessageKeybinding)
	const setSendMessageKeybinding = useSettingsStore((s) => s.setSendMessageKeybinding)

	return (
		<div className="max-w-3xl divide-y divide-border">
			<div className="flex flex-col items-stretch gap-3 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
				<div className="min-w-0 space-y-1">
					<Label htmlFor="archive-keybinding">Archive</Label>
					<p className="text-sm text-muted-foreground">
						Archive the focused task or session anywhere archiving is available.
					</p>
				</div>
				<Select
					value={archiveKeybinding}
					onValueChange={(value) => setArchiveKeybinding(value as ArchiveKeybinding)}
				>
					<SelectTrigger id="archive-keybinding" className="w-full shrink-0 sm:w-[200px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="mod+e">{formatKeybindingOption('mod+e')}</SelectItem>
						<SelectItem value="e">E</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col items-stretch gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
				<div className="min-w-0 space-y-1">
					<Label htmlFor="send-message-keybinding">Send message</Label>
					<p className="text-sm text-muted-foreground">
						Send from the task and session composers. With Enter selected, Shift Enter inserts a line break.
					</p>
				</div>
				<Select
					value={sendMessageKeybinding}
					onValueChange={(value) => setSendMessageKeybinding(value as SendMessageKeybinding)}
				>
					<SelectTrigger id="send-message-keybinding" className="w-full shrink-0 sm:w-[200px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="mod+enter">{formatKeybindingOption('mod+enter')}</SelectItem>
						<SelectItem value="enter">Enter</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	)
}
