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
	const typedPath = useState('')
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
			<DirectoryItems
				host={host}
				selected={target?.kind === 'directory' ? target.path : null}
				onPick={(path) => pick({ kind: 'directory', path })}
				typedPath={typedPath}
			/>
		</Menu>
	)
}

/** Recent directories on the host, then a path to type, for a session that needs a directory there. */
export function DirectoryMenu({
	anchor,
	open,
	onClose,
	host,
	selected,
	onPick,
}: MenuProps & { host: HostView | null; selected: string | null; onPick: (path: string) => void }) {
	const typedPath = useState('')
	return (
		<Menu anchor={anchor} open={open} onClose={onClose} placement="above-start" width={340}>
			<DirectoryItems
				host={host}
				selected={selected}
				onPick={(path) => {
					onPick(path)
					onClose()
				}}
				typedPath={typedPath}
			/>
		</Menu>
	)
}

/**
 * The "Directories on <host>" part of a menu: the host's recent directories and a field for any
 * other path. The typed path is held by the menu, which stays mounted while it is closed, so a
 * half-typed path is still there when the menu opens again.
 */
function DirectoryItems({
	host,
	selected,
	onPick,
	typedPath: [typedPath, setTypedPath],
}: {
	host: HostView | null
	selected: string | null
	onPick: (path: string) => void
	typedPath: [string, (path: string) => void]
}) {
	const directories = useRecentDirectories(host?.host.host_id ?? null)
	return (
		<>
			<MenuLabel>Directories on {host?.name ?? 'this host'}</MenuLabel>
			{directories.slice(0, 8).map((path) => (
				<MenuItem
					key={path}
					icon={<Folder className="i sm" strokeWidth={1.6} />}
					label={basename(path)}
					detail={shortPath(path)}
					checked={selected === path}
					onSelect={() => onPick(path)}
				/>
			))}
			<MenuSeparator />
			<form
				className="path-form"
				onSubmit={(event) => {
					event.preventDefault()
					if (!typedPath.trim()) return
					onPick(typedPath.trim())
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
		</>
	)
}

/** Every host with its status, version and usage. Offline hosts can't be picked. */
export function HostMenu({
	anchor,
	open,
	onClose,
	selectedId,
	onPick,
}: MenuProps & {
	selectedId: string | null
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
					disabled={!entry.online}
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
