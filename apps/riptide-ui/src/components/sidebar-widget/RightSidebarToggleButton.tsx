import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'

/**
 * Open/close button for the right sidebar, mirroring LeftSidebarToggleButton.
 * The `s` / `⇧S` hotkeys cycle tabs before collapsing; the button is a plain
 * toggle, with the shortcuts surfaced in the tooltip.
 */
export function RightSidebarToggleButton({
	sidebarCollapsed,
	onToggleSidebar,
}: {
	sidebarCollapsed: boolean
	onToggleSidebar: () => void
}) {
	const label = sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'
	const ToggleIcon = sidebarCollapsed ? PanelRightOpen : PanelRightClose

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button type="button" size="sm" variant="ghost" onClick={onToggleSidebar} aria-label={label}>
					<ToggleIcon className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<p className="flex items-center gap-1">
					{label} <KeyboardShortcut size="xs">S</KeyboardShortcut>
					<KeyboardShortcut size="xs">⇧+S</KeyboardShortcut>
				</p>
			</TooltipContent>
		</Tooltip>
	)
}
