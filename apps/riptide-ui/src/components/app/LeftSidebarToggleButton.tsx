import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'

export function LeftSidebarToggleButton({
	sidebarCollapsed,
	onToggleSidebar,
}: {
	sidebarCollapsed: boolean
	onToggleSidebar: () => void
}) {
	const toggleSidebarKeys = formatShortcut(hotkeysCatalog.global.shortcuts.toggleSidebar.display)
	const label = sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'
	const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button type="button" size="sm" variant="ghost" onClick={onToggleSidebar} aria-label={label}>
					<ToggleIcon className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<p className="flex items-center gap-1">
					{label} <KeyboardShortcut size="xs">{toggleSidebarKeys}</KeyboardShortcut>
				</p>
			</TooltipContent>
		</Tooltip>
	)
}
