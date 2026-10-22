import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@humanlayer/ui/components/sidebar'
import { useAuth } from '@workos-inc/authkit-react'
import { ChevronsUpDown, LogOut } from 'lucide-react'

export function NavUser() {
	const { user, signOut } = useAuth()
	const { isMobile } = useSidebar()

	if (!user) return null

	const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
	const initials = displayName
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<Avatar className="h-8 w-8 rounded-lg">
								<AvatarImage src={user.profilePictureUrl || undefined} alt={displayName} />
								<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{displayName}</span>
								<span className="truncate text-xs">{user.email}</span>
							</div>
							<ChevronsUpDown className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						side={isMobile ? 'bottom' : 'right'}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar className="h-8 w-8 rounded-lg">
									<AvatarImage src={user.profilePictureUrl || undefined} alt={displayName} />
									<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{displayName}</span>
									<span className="truncate text-xs">{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => signOut({ returnTo: window.location.origin })}>
							<LogOut className="size-4" />
							<span>Sign out</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	)
}
