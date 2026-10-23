import type { ReactNode } from 'react'

export function SidebarFooterBar({ children }: { children: ReactNode }) {
	return (
		<div className="flex shrink-0 items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground">
			{children}
		</div>
	)
}
