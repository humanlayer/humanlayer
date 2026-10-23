import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Archive, Building2, LogOut, Settings } from 'lucide-react'
import { useRef, useState } from 'react'

import { useBrowserAuth as useAuth } from '@/hooks/use-browser-auth'
import { WiredUserAvatar } from '@/minimalist/components/Avatar'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { UsageBars } from '@/minimalist/components/UsageBars'
import { useHosts } from '@/minimalist/lib/data'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

/** The sidebar's footer: who you are and which host is online; its menu has usage, settings and organizations. */
export function AccountMenu() {
	const { user, signOut, organizationId, switchOrganization } = useAuth()
	const { queryClient: orpc } = useRiptideApi()
	const organizations =
		useQuery({ ...orpc.auth.user.organizations.list.queryOptions(), staleTime: 60_000 }).data?.organizations ?? []
	const { showToast } = useUi()
	const { hosts, isReady: hostsReady } = useHosts()
	const navigate = useNavigate()
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const onlineHost = hosts.find((host) => host.online)
	const usageHost = onlineHost ?? hosts[0]
	const go = (to: '/settings/general' | '/settings/archived') => {
		setOpen(false)
		void navigate({ to })
	}
	return (
		<>
			<button type="button" ref={anchor} className="me" onClick={() => setOpen(true)}>
				{user ? <WiredUserAvatar userId={user.id} /> : null}
				<span className="ell">{user?.firstName ?? user?.email}</span>
				{hostsReady ? (
					<span className="host-chip">
						<span className={`dot ${onlineHost ? 'ok' : 'off'}`} />
						{onlineHost ? onlineHost.name : 'No host online'}
					</span>
				) : null}
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="above-start" width={260}>
				{usageHost ? (
					<>
						<MenuLabel>Usage on {usageHost.name}</MenuLabel>
						<UsageBars limits={usageHost.host.coding_agent_usage_limits?.claude} />
						<MenuSeparator />
					</>
				) : null}
				<MenuItem
					icon={<Settings className="i sm" strokeWidth={1.6} />}
					label="Settings"
					kbd={shortcutHint('settings')}
					onSelect={() => go('/settings/general')}
				/>
				<MenuItem
					icon={<Archive className="i sm" strokeWidth={1.6} />}
					label="Archived"
					onSelect={() => go('/settings/archived')}
				/>
				{organizations.length > 1 ? (
					<>
						<MenuSeparator />
						<MenuLabel>Organizations</MenuLabel>
						{organizations.map((org) => (
							<MenuItem
								key={org.organizationId}
								icon={<Building2 className="i sm" strokeWidth={1.6} />}
								label={org.organizationName}
								checked={org.organizationId === organizationId}
								onSelect={() => {
									setOpen(false)
									if (org.organizationId === organizationId) return
									switchOrganization({ organizationId: org.organizationId }).catch(() =>
										showToast(`Could not switch to ${org.organizationName}. Try again.`),
									)
								}}
							/>
						))}
					</>
				) : null}
				<MenuSeparator />
				<MenuItem
					icon={<LogOut className="i sm" strokeWidth={1.6} />}
					label="Sign out"
					onSelect={() => signOut({ returnTo: window.location.origin })}
				/>
			</Menu>
		</>
	)
}
