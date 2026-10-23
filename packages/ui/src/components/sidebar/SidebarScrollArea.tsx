import type { ReactNode } from 'react'

export function SidebarScrollArea({ children }: { children: ReactNode }) {
	return <div className="flex-1 overflow-y-auto">{children}</div>
}
