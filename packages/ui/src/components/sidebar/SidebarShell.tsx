import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

export interface SidebarShellProps {
	children: ReactNode
	className?: string
}

/** Pure column shell. Production and stories own every stacked child. */
export function SidebarShell({ children, className }: SidebarShellProps) {
	return (
		<div
			className={cn(
				'flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground',
				className,
			)}
		>
			{children}
		</div>
	)
}
