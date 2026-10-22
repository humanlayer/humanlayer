import { useNavigate } from '@tanstack/react-router'
import { Folder, FolderGit2, Laptop, Plus, Server } from 'lucide-react'
import { type RefObject, useState } from 'react'

import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { usageSummary } from '@/minimalist/components/UsageBars'
import { type HostView, useHosts, useProjects, useRecentDirectories } from '@/minimalist/lib/data'
import { basename, formatAgo, shortPath } from '@/minimalist/lib/format'
import type { Target } from '@/minimalist/lib/launch'

type MenuProps = { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void }

/** Projects, then recent directories on the host, then a path to type. */
export function TargetMenu({
	anchor,
	open,
	onClose,
	host,
	target,
	onPick,
}: MenuProps & { host: HostView | null; target: Target | null; onPick: (target: Target) => void }) {
	const navigate = useNavigate()
	const projects = useProjects()
	const directories = useRecentDirectories(host?.host.host_id ?? null)
	const [typedPath, setTypedPath] = useState('')
	const pick = (next: Target) => {
		onPick(next)
		onClose()
	}
	return (
		<Menu anchor={anchor} open={open} onClose={onClose} placement="above-start" width={340}>
			{projects.data && projects.data.length > 0 ? <MenuLabel>Projects</MenuLabel> : null}
			{projects.data?.map((project) => (
				<MenuItem
					key={project.id}
					icon={<FolderGit2 className="i sm" strokeWidth={1.6} />}
					label={project.name}
					detail={project.repositories.map((repository) => repository.repositoryIdentity).join(', ')}
					checked={target?.kind === 'project' && target.projectId === project.id}
					onSelect={() => pick({ kind: 'project', projectId: project.id, name: project.name })}
				/>
			))}
			<MenuItem
				icon={<Plus className="i sm" strokeWidth={1.6} />}
				label="Add project…"
				onSelect={() => {
					onClose()
					void navigate({ to: '/settings/projects/new' })
				}}
			/>
			<MenuSeparator />
			<MenuLabel>Directories on {host?.name ?? 'this host'}</MenuLabel>
			{directories.slice(0, 8).map((path) => (
				<MenuItem
					key={path}
					icon={<Folder className="i sm" strokeWidth={1.6} />}
					label={basename(path)}
					detail={shortPath(path)}
					checked={target?.kind === 'directory' && target.path === path}
					onSelect={() => pick({ kind: 'directory', path })}
				/>
			))}
			<MenuSeparator />
			<form
				className="path-form"
				onSubmit={(event) => {
					event.preventDefault()
					if (!typedPath.trim()) return
					pick({ kind: 'directory', path: typedPath.trim() })
					setTypedPath('')
				}}
			>
				<input
					aria-label="Directory path"
					className="filter"
					placeholder={`Path on ${host?.name ?? 'the host'}, e.g. ~/code/app`}
					value={typedPath}
					onChange={(event) => setTypedPath(event.target.value)}
				/>
				<button type="submit" className="btn" disabled={!typedPath.trim()}>
					Use directory
				</button>
			</form>
		</Menu>
	)
}

/** Every host with its status, version and usage. Offline hosts, and others when `lockedTo` is set, can't be picked. */
export function HostMenu({
	anchor,
	open,
	onClose,
	selectedId,
	lockedTo,
	onPick,
}: MenuProps & {
	selectedId: string | null
	/** A directory task stays on the host that has its directory. */
	lockedTo: string | null
	onPick: (hostId: string) => void
}) {
	const { hosts, isReady } = useHosts()
	return (
		<Menu anchor={anchor} open={open} onClose={onClose} placement="above-start" width={320}>
			<MenuLabel>Run on</MenuLabel>
			{isReady && hosts.length === 0 ? (
				<div className="empty">No hosts yet. Start a daemon to add one.</div>
			) : null}
			{hosts.map((entry) => (
				<MenuItem
					key={entry.host.host_id}
					icon={<HostIcon host={entry} />}
					label={
						<>
							{entry.name}{' '}
							<span className={`badge host-state ${entry.online ? 'ok' : ''}`}>
								{entry.online ? 'Online' : 'Offline'}
							</span>
						</>
					}
					detail={[
						entry.local ? 'This computer' : null,
						entry.host.distribution === 'cli' ? 'CLI' : 'Desktop app',
						entry.host.daemon_version,
						entry.online
							? usageSummary(entry.host.coding_agent_usage_limits?.claude)
							: `last seen ${formatAgo(entry.lastSeen)}`,
					]
						.filter(Boolean)
						.join(' · ')}
					checked={selectedId === entry.host.host_id}
					disabled={!entry.online || (lockedTo !== null && entry.host.host_id !== lockedTo)}
					onSelect={() => {
						onPick(entry.host.host_id)
						onClose()
					}}
				/>
			))}
		</Menu>
	)
}

/** A server for CLI daemons, a laptop for the desktop app. */
export function HostIcon({ host }: { host: HostView | null }) {
	return host?.host.distribution === 'cli' ? (
		<Server className="i sm" strokeWidth={1.6} />
	) : (
		<Laptop className="i sm" strokeWidth={1.6} />
	)
}
