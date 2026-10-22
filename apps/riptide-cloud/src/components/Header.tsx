import { SidebarTrigger } from '@humanlayer/ui/components/sidebar'

import { AppBreadcrumb } from './AppBreadcrumb'

export function Header() {
	return (
		<header className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 w-full shrink-0">
			<SidebarTrigger />
			<AppBreadcrumb />
		</header>
	)
}
