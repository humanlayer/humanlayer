import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { Link, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'

import {
	isSettingsSectionVisible,
	SETTINGS_SECTION_GROUPS,
	SETTINGS_SECTION_LABELS,
	SETTINGS_SECTION_PATHS,
	type SettingsSection,
	useSettingsVisibilityContext,
} from '@/components/settings/settings-sections'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { navigateBackFromSettings, navigateWithinSettings } from '@/lib/settings-navigation'
import { hasMacWindowControls } from '@/lib/tauri-chrome'

/**
 * The settings section-nav sidebar that replaces the task tree while settings
 * routes are active. Renders the grouped section list with the active section
 * highlighted, hides conditional sections (and empty group headers), shows a
 * jump-number for the first ten items (0–9), and offers a "Back to app"
 * affordance. The column sizes to its own content rather than being
 * resizable/collapsible.
 */
export function SettingsSectionNav() {
	const location = useLocation()
	const navigate = useNavigate()
	const router = useRouter()
	const visibility = useSettingsVisibilityContext()
	const { roles, billingPreviewEnabled, projectsV2Enabled } = visibility

	const isActive = (section: SettingsSection) =>
		location.pathname === SETTINGS_SECTION_PATHS[section] ||
		location.pathname.startsWith(`${SETTINGS_SECTION_PATHS[section]}/`)

	// Visible sections in display (top-to-bottom) order. The jump-number shown
	// next to each item and the digit hotkeys both index into this list, so they
	// stay in sync even as gated sections (Billing, Agent, Projects) appear or
	// disappear.
	const visibleSections = useMemo(
		() =>
			SETTINGS_SECTION_GROUPS.flatMap((group) =>
				group.sections.filter((section) =>
					isSettingsSectionVisible(section, { roles, billingPreviewEnabled, projectsV2Enabled }),
				),
			),
		[roles, billingPreviewEnabled, projectsV2Enabled],
	)

	// Sections past the tenth get no number: a two-digit jump key makes no sense.
	const sectionNumbers = useMemo(() => {
		const numbers = new Map<SettingsSection, number>()
		visibleSections.slice(0, 10).forEach((section, index) => numbers.set(section, index))
		return numbers
	}, [visibleSections])

	// 0–9 jump straight to the matching visible section. Leaving `enableOnFormTags`
	// at its default keeps these from firing while typing in a settings field.
	useHotkeys(
		['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
		(event) => {
			const section = visibleSections[Number(event.key)]
			if (section) {
				navigateWithinSettings(navigate, section)
			}
		},
		{ scopes: [HOTKEY_SCOPES.SETTINGS], preventDefault: true },
		[visibleSections, navigate],
	)

	return (
		<div className="flex h-full min-h-0 w-fit flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
			<div
				data-tauri-drag-region
				className={cn(
					'flex h-12 shrink-0 items-center border-b border-sidebar-border px-4',
					hasMacWindowControls() && 'pl-22',
				)}
			>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="w-full justify-between gap-3"
					onClick={() => navigateBackFromSettings(router.history)}
				>
					<span className="flex items-center gap-2 whitespace-nowrap">
						<ArrowLeft className="h-3.5 w-3.5" />
						Back to app
					</span>
					<KeyboardShortcut size="xs">ESC</KeyboardShortcut>
				</Button>
			</div>

			<div className="shrink-0 px-4 py-3 text-xs font-semibold uppercase tracking-[0.13em] text-accent">
				Settings
			</div>

			<nav className="flex-1 overflow-y-auto">
				{SETTINGS_SECTION_GROUPS.map((group) => {
					const groupSections = group.sections.filter((section) =>
						isSettingsSectionVisible(section, visibility),
					)
					if (groupSections.length === 0) return null

					return (
						<div key={group.label ?? 'top'} className="py-1.5 [&+&]:border-t [&+&]:border-sidebar-border">
							{group.label && (
								<div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
									{group.label}
								</div>
							)}
							{groupSections.map((section) => {
								const active = isActive(section)
								return (
									<Link
										key={section}
										to={SETTINGS_SECTION_PATHS[section]}
										replace
										className={cn(
											'flex items-center justify-between gap-6 border-l-2 border-transparent px-4 py-1.5 text-xs uppercase tracking-[0.07em] whitespace-nowrap transition-colors',
											active
												? 'border-l-[var(--terminal-accent)] bg-sidebar-accent font-semibold text-accent'
												: 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
										)}
										aria-current={active ? 'page' : undefined}
									>
										<span>{SETTINGS_SECTION_LABELS[section]}</span>
										{sectionNumbers.has(section) && (
											<KeyboardShortcut size="xs">{sectionNumbers.get(section)}</KeyboardShortcut>
										)}
									</Link>
								)
							})}
						</div>
					)
				})}
			</nav>
		</div>
	)
}
