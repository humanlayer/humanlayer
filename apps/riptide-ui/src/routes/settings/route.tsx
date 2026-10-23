import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { createFileRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router'

import { AppShell } from '@/components/app/AppShell'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import {
	isSettingsSection,
	getSettingsSectionTitle,
	shouldSuppressSettingsSectionTitle,
} from '@/components/settings/settings-sections'
import { SettingsSectionNav } from '@/components/settings/SettingsSectionNav'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { navigateBackFromSettings } from '@/lib/settings-navigation'
import { cn } from '@/lib/utils'
import { MinimalistSettingsLayout } from '@/minimalist/components/SettingsLayout'

export const Route = createFileRoute('/settings')({
	component: SettingsLayout,
})

function SettingsLayout() {
	const minimalist = useMinimalistLayout()
	if (minimalist)
		return (
			<MinimalistSettingsLayout>
				<Outlet />
			</MinimalistSettingsLayout>
		)
	return <StandardSettingsLayout />
}

function StandardSettingsLayout() {
	const router = useRouter()
	const location = useLocation()
	const creatingProject = location.pathname === '/settings/projects/new'

	// Esc leaves settings and returns to the app, mirroring the modal dismissal it
	// replaces. It routes through the same helper as the sidebar "Back to app"
	// button so both exits share one destination. Scoped to SETTINGS so it only
	// fires while a settings route is mounted.
	useHotkeys(
		'Escape',
		() => {
			navigateBackFromSettings(router.history)
		},
		{
			scopes: [HOTKEY_SCOPES.SETTINGS],
			enabled: !creatingProject,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[router],
	)

	// Page title mirrors the active section's breadcrumb label.
	const section = location.pathname.split('/').filter(Boolean)[1]
	const suppressTitle = shouldSuppressSettingsSectionTitle(section)
	let title = 'Settings'
	if (creatingProject) title = 'New project'
	else if (isSettingsSection(section)) title = getSettingsSectionTitle(section)

	// Most sections are a single comfortable-width column. General lays its groups
	// out as two side-by-side columns, so it opts out of the shared max-width and
	// manages its own responsive width internally. Projects lists repository rows
	// with long identities and inline actions, so it gets a wider column.
	let maxWidthClass = 'max-w-3xl'
	if (creatingProject) maxWidthClass = 'w-full max-w-6xl'
	else if (section === 'general') maxWidthClass = 'max-w-none'
	else if (section === 'projects' || section === 'access-requests' || section === 'users') maxWidthClass = 'max-w-5xl'

	return (
		<HotkeyScopeBoundary
			scope={creatingProject ? HOTKEY_SCOPES.PROJECT_CREATE_PAGE : HOTKEY_SCOPES.SETTINGS}
			componentName="SettingsLayout"
		>
			<div className="flex flex-col grow min-h-0">
				<AppShell resizableSidebar={false} sidebar={<SettingsSectionNav />}>
					<div className="h-full overflow-y-auto">
						<div className={cn('px-8 pt-6 pb-12', maxWidthClass)}>
							{!suppressTitle ? (
								<h1
									className={cn(
										'font-mono text-lg font-semibold tracking-tight text-foreground',
										creatingProject ? 'mb-2' : 'mb-6',
									)}
								>
									{title}
								</h1>
							) : null}
							<Outlet />
						</div>
					</div>
				</AppShell>
			</div>
		</HotkeyScopeBoundary>
	)
}
