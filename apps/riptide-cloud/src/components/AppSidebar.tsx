import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@humanlayer/ui/components/sidebar'
import { Link, useLocation } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { BarChart, Download, FileText, Gauge, Mail, Settings, Users } from 'lucide-react'

import { useUserInfo } from '@/hooks/useUserInfo'

import { AdminRequestQueueBadge } from './AdminRequestQueueBadge'
import { NavUser } from './NavUser'

type SidebarItem = {
	url: string
	title: string
	icon: React.ComponentType<{ className?: string }>
	badge?: React.ReactNode
}

export function AppSidebar() {
	const location = useLocation()
	const { user, roles } = useAuth()
	const { advancedMetricsVisible } = useUserInfo()
	const isAdmin = roles?.includes('admin')

	const items: SidebarItem[] = [
		{ title: 'Install', url: '/install', icon: Download },
		{ title: 'Artifacts', url: '/tasks', icon: FileText },
		{ title: 'Team Metrics', url: '/metrics', icon: BarChart },
	]

	// Mirrors the /admin/advanced-metrics route guard: entitled org, and either an admin or an org
	// that shares the page with every member.
	if (advancedMetricsVisible) {
		items.push({ title: 'Advanced Metrics', url: '/admin/advanced-metrics', icon: Gauge })
	}

	if (isAdmin) {
		items.push(
			{ title: 'Users', url: '/admin/users', icon: Users },
			{ title: 'Invitations', url: '/admin/invitations', icon: Mail, badge: <AdminRequestQueueBadge /> },
			{ title: 'Settings', url: '/settings', icon: Settings },
		)
	}

	return (
		<Sidebar>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel className="uppercase">HumanLayer Cloud</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{items.map((item) => {
								const isActive =
									item.url === '/tasks'
										? location.pathname.startsWith('/tasks') ||
											location.pathname.startsWith('/artifacts')
										: location.pathname.startsWith(item.url)
								return (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton asChild isActive={isActive}>
											<Link to={item.url} className="flex w-full items-center">
												<item.icon className="h-4 w-4" />
												<span>{item.title}</span>
												{item.badge}
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								)
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			{user && (
				<SidebarFooter>
					<NavUser />
				</SidebarFooter>
			)}
		</Sidebar>
	)
}
