import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@humanlayer/ui/components/breadcrumb'
import { Link } from '@tanstack/react-router'

import { NewHorizontalTabButton } from '@/components/horizontal-tabs/NewHorizontalTabButton'
import { WiredNotificationBell } from '@/components/notifications/WiredNotificationBell'

import { getSettingsSectionTitle, isSettingsSection } from './settings-sections'

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
	const section = pathname.split('/').filter(Boolean)[1]
	const sectionLabel = isSettingsSection(section) ? getSettingsSectionTitle(section) : undefined
	const creatingProject = pathname === '/settings/projects/new'

	return (
		<Breadcrumb
			data-tauri-drag-region
			className="flex h-9 items-center py-1 font-mono text-sm shrink-0 px-8 min-w-0 w-full overflow-hidden"
		>
			<BreadcrumbList
				data-tauri-drag-region
				className="min-w-0 flex-1 flex-nowrap overflow-hidden [&_[data-slot=breadcrumb-separator]]:shrink-0"
			>
				<BreadcrumbItem className="shrink-0">
					<BreadcrumbLink asChild className="cursor-pointer">
						<Link to="/sessions">HumanLayer</Link>
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem className="shrink-0">
					{sectionLabel ? (
						<BreadcrumbLink asChild className="cursor-pointer">
							<Link to="/settings" replace>
								Settings
							</Link>
						</BreadcrumbLink>
					) : (
						<BreadcrumbPage>Settings</BreadcrumbPage>
					)}
				</BreadcrumbItem>
				{sectionLabel && (
					<>
						<BreadcrumbSeparator />
						<BreadcrumbItem className="shrink-0">
							{creatingProject ? (
								<BreadcrumbLink asChild>
									<Link to="/settings/projects" replace>
										{sectionLabel}
									</Link>
								</BreadcrumbLink>
							) : (
								<BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
							)}
						</BreadcrumbItem>
					</>
				)}
				{creatingProject && (
					<>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>New</BreadcrumbPage>
						</BreadcrumbItem>
					</>
				)}
			</BreadcrumbList>
			<NewHorizontalTabButton className="ml-2" />
			<WiredNotificationBell placement="page" className="ml-1" />
		</Breadcrumb>
	)
}
