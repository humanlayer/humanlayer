import { Plus, Search } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../button'
import { KeyboardShortcut } from '../keyboard-shortcut'

export interface SidebarHeaderBarProps {
	onOpenCommandPalette: () => void
	onCreateTask?: () => void
	leadingAction?: ReactNode
}

export function SidebarHeaderBar({ onOpenCommandPalette, onCreateTask, leadingAction }: SidebarHeaderBarProps) {
	return (
		// data-tauri-drag-region: in the desktop app this row sits at the very top
		// of the window and doubles as the titlebar drag handle; the macOS traffic
		// lights float over its left side. Inert in the browser. The labels collapse
		// in tiers as the sidebar narrows so the buttons leave room for the leading
		// action and traffic lights (breakpoints are content-box widths, which exclude
		// the px-4 padding): below 24rem "Search" becomes an icon + shortcut, below
		// 21.5rem "Create Task" becomes an icon + shortcut.
		<div
			data-tauri-drag-region
			className="@container flex h-12 shrink-0 items-center justify-between gap-2 px-4"
		>
			{leadingAction}
			<div className="flex items-center gap-2">
				<Button type="button" size="sm" variant="ghost" onClick={onOpenCommandPalette}>
					<Search className="size-4 @[24rem]:hidden" />
					<span className="@max-[24rem]:hidden">Search</span>
					<KeyboardShortcut size="xs">⌘+K</KeyboardShortcut>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="default"
					onClick={onCreateTask}
					disabled={!onCreateTask}
					title="Create Task"
					aria-label="Create Task"
				>
					<Plus className="size-4 @[21.5rem]:hidden" />
					<span className="@max-[21.5rem]:hidden">Create Task</span>
					<KeyboardShortcut size="xs">T</KeyboardShortcut>
				</Button>
			</div>
		</div>
	)
}
