import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import {
	isSettingsSectionVisible,
	type SettingsSection,
	useSettingsVisibilityContext,
} from '@/components/settings/settings-sections'
import { useMountEffect } from '@/hooks/useMountEffect'
import { navigateBackFromSettings } from '@/lib/settings-navigation'
import { useMinimalistDark } from '@/minimalist/lib/color-scheme'
import { selectWithArrows } from '@/minimalist/lib/roving'

import { AddProjectPage } from './AddProjectPage'
import {
	ArchivedSettingsPage,
	GeneralSettingsPage,
	GitSettingsPage,
	ProjectsOptInPage,
	ShortcutsSettingsPage,
} from './SettingsPages'

type Slug =
	| 'git'
	| 'general'
	| 'agent'
	| 'keybindings'
	| 'daemons'
	| 'projects'
	| 'agent-sign-in'
	| 'personal-access-tokens'
	| 'billing'
	| 'experiments'
	| 'updates'
	| 'sync'
	| 'diagnostics'
	| 'users'
	| 'access-requests'
	| 'archived'

type Page = { slug: Slug; label: string; section?: SettingsSection; native?: () => ReactNode; also?: Slug[] }

/**
 * Fewer, plainer pages than the standard settings. Tips folds away; Sync,
 * Diagnostics and Updates share one About page because each is a line or two.
 */
const NAV: Array<{ label?: string; pages: Page[] }> = [
	{
		pages: [
			{ slug: 'general', label: 'General', native: GeneralSettingsPage },
			{ slug: 'agent', label: 'Agent defaults', section: 'agent' },
			{ slug: 'agent-sign-in', label: 'Agent sign-in', section: 'agent-sign-in' },
			{ slug: 'keybindings', label: 'Keyboard shortcuts', native: ShortcutsSettingsPage },
			{ slug: 'archived', label: 'Archived tasks', native: ArchivedSettingsPage },
		],
	},
	{
		label: 'Coding',
		pages: [
			{ slug: 'daemons', label: 'Hosts', section: 'daemons' },
			{ slug: 'projects', label: 'Projects', section: 'projects' },
			{ slug: 'git', label: 'Git', native: GitSettingsPage },
		],
	},
	{
		label: 'Account',
		pages: [
			{ slug: 'personal-access-tokens', label: 'Access tokens', section: 'personal-access-tokens' },
			{ slug: 'billing', label: 'Billing', section: 'billing' },
			{ slug: 'experiments', label: 'Experiments', section: 'experiments' },
			{ slug: 'updates', label: 'About', section: 'updates', also: ['sync', 'diagnostics'] },
		],
	},
	{
		label: 'Organization',
		pages: [
			{ slug: 'users', label: 'Members', section: 'users' },
			{ slug: 'access-requests', label: 'Access requests', section: 'access-requests' },
		],
	},
]

const PAGES = NAV.flatMap((group) => group.pages)

export function MinimalistSettingsLayout({ children }: { children: ReactNode }) {
	const router = useRouter()
	const { pathname } = useLocation()
	const visibility = useSettingsVisibilityContext()
	const dark = useMinimalistDark()
	const slug = pathname.split('/')[2] ?? 'general'
	const page = PAGES.find((item) => item.slug === slug || item.also?.includes(slug as Slug))
	// Projects are central here, so the page always shows; without Projects V2 it offers to turn them on.
	const visible = (item: Page) =>
		!item.section || item.slug === 'projects' || isSettingsSectionVisible(item.section, visibility)
	const adding = page?.slug === 'projects' && pathname.endsWith('/new')
	const Native =
		page?.slug === 'projects' && !visibility.projectsV2Enabled
			? ProjectsOptInPage
			: adding
				? AddProjectPage
				: page?.native
	const title = adding ? 'Add project' : (page?.label ?? 'Settings')

	useMountEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return
			const target = event.target as HTMLElement | null
			if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
			navigateBackFromSettings(router.history)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	return (
		<div className="app">
			<aside className="settings-nav" aria-label="Settings sections">
				<nav className="nav">
					<button
						type="button"
						className="navlink back"
						onClick={() => navigateBackFromSettings(router.history)}
					>
						<ArrowLeft className="i" />
						Back to app
					</button>
					{NAV.map((group, index) => {
						const pages = group.pages.filter(visible)
						if (pages.length === 0) return null
						return (
							<div key={group.label ?? index} className="navgroup">
								{group.label ? <div className="section">{group.label}</div> : null}
								{pages.map((item) => (
									<Link
										key={item.slug}
										replace
										to={`/settings/${item.slug}`}
										className={page === item ? 'sel' : ''}
									>
										{item.label}
									</Link>
								))}
							</div>
						)
					})}
				</nav>
			</aside>
			<div className="settings-page">
				<div className="inner">
					<h1 className="h1">{title}</h1>
					{page?.also ? <AboutTabs slug={slug} /> : null}
					{Native ? (
						<Native />
					) : (
						// Shared sections read the standard theme tokens; pin them to the minimalist palette.
						<div
							data-theme={dark ? 'framer-dark' : 'framer-light'}
							className="minimalist-shared rounded-corners shared-settings"
						>
							{children}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

/** Updates, Sync and Diagnostics each get a small tab row instead of three nav entries. */
function AboutTabs({ slug }: { slug: string }) {
	const tabs: Array<{ slug: Slug; label: string }> = [
		{ slug: 'updates', label: 'Version' },
		{ slug: 'sync', label: 'Sync' },
		{ slug: 'diagnostics', label: 'Diagnostics' },
	]
	return (
		<div className="about-tabs" role="tablist" aria-label="About" onKeyDown={selectWithArrows}>
			{tabs.map((tab) => (
				<Link
					key={tab.slug}
					replace
					role="tab"
					aria-selected={slug === tab.slug}
					tabIndex={slug === tab.slug ? 0 : -1}
					to={`/settings/${tab.slug}`}
					className={slug === tab.slug ? 'on' : ''}
				>
					{tab.label}
				</Link>
			))}
		</div>
	)
}
