import type { ReactNode } from 'react'

import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { cn } from '@/lib/utils'

/**
 * Top strip of the full-height right sidebar. Matches the breadcrumb row's
 * height so the two rows read as one titlebar across the panel divider, doubles
 * as the window drag region, and hosts the controls that leave the breadcrumb
 * while the sidebar is open (host name, sidebar toggle).
 */
export function SidebarWidgetHeaderStrip({ children }: { children?: ReactNode }) {
	// Same foreground tint as SidebarWidget so the strip and the widget below it
	// paint as one continuous column.
	const isRightPaneFocused = useFocusStore((state) => state.focusedArea === FOCUSED_AREAS.RIGHT_PANE)
	return (
		<div
			data-tauri-drag-region
			className={cn(
				'flex h-9 shrink-0 items-center justify-end gap-2 overflow-hidden px-3 text-muted-foreground',
				isRightPaneFocused ? 'bg-foreground/6' : 'bg-foreground/3',
			)}
		>
			{children}
		</div>
	)
}
