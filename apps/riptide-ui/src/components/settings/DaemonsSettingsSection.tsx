import type { HostMachine, HostStats } from '@humanlayer/db/tables/online-hosts'
import type { ClaudeUsageLimits } from '@humanlayer/schemas/zod/host/usage-limits'
import { Button } from '@humanlayer/ui/components/button'
import { Input } from '@humanlayer/ui/components/input'
import { getHumanLayerCliInstallCommand } from '@humanlayer/ui/lib/humanlayer-cli'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMutation } from '@tanstack/react-query'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Check, Copy, Pencil, Terminal, Trash2, X } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { toast } from 'sonner'

import { getOnlineHostKey } from '@/collections/online-host-key'
import { HostActiveSessionsWired } from '@/components/host-stats/HostActiveSessionsWired'
import { HostStatBar } from '@/components/host-stats/HostStatsMeters'
import { HostTopProcesses } from '@/components/host-stats/HostTopProcesses'
import { LaunchDaemonEntryPoint } from '@/components/launch-daemon/LaunchDaemonEntryPoint'
import { LaunchDaemonModal } from '@/components/launch-daemon/LaunchDaemonModal'
import { useSync } from '@/components/providers/SyncProvider'
import { UsageLimitBars } from '@/components/usage-limits/UsageLimitBars'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { getDeleteHostErrorDescription, useDeleteHost } from '@/hooks/use-delete-host'
import { useHostAliases, useUpsertHostAlias } from '@/hooks/use-host-aliases'
import { useLaunchDaemon } from '@/hooks/use-launch-daemon'
import { useRequestHostUpdate } from '@/hooks/use-request-host-update'
import { useDaemonCliStage, useTargetDaemonVersion } from '@/hooks/use-target-daemon-version'
import { useUserInfo } from '@/hooks/useUserInfo'
import { isAttachedSessionsOnly, mirroredAgentLabel } from '@/lib/daemon-version'
import {
	formatGb,
	formatGbShort,
	formatDuration,
	formatUptime,
	getHostPressure,
	type HostPressure,
	type HostStatsSample,
	historySpanMs,
	useHostStatsHistory,
} from '@/lib/host-stats'
import { canDeleteHost, getHostStatus } from '@/lib/host-status'
import {
	getHostUpdateState,
	hasOldSelfUpdater,
	isHostUpdatable,
	isUpdateStalled,
	OLD_UPDATER_STALLED_UPDATE_ERROR,
	STALLED_UPDATE_ERROR,
} from '@/lib/host-update'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

import { buildDaemonLaunchCommand } from './daemon-launch-command'
import { HostDeleteDialog } from './HostDeleteDialog'
import { HostUpdateControl } from './HostUpdateControl'
import { LocalDaemonSetting } from './LocalDaemonSetting'

export function DaemonsSettingsSection() {
	const { client, queryClient: api } = useRiptideApi()
	const { user, organizationId } = useAuth()
	const { userId } = useUserInfo()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const hostStatsEnabled = useSettingsStore((s) => s.hostStatsEnabled)
	const localDaemonEnabled = useSettingsStore((s) => s.localDaemonEnabled)
	const { onlineHostsCollection } = useSync()
	const [, copyToClipboard] = useCopyToClipboard()
	const [generatedToken, setGeneratedToken] = useState<{ token: string; expiresAt: string } | null>(null)
	const [launchModalOpen, setLaunchModalOpen] = useState(false)
	const [deleteTarget, setDeleteTarget] = useState<{ hostId: string; displayName: string } | null>(null)
	const deleteHost = useDeleteHost()

	const confirmDelete = async () => {
		if (!deleteTarget || deleteHost.isPending) return
		try {
			await deleteHost.mutateAsync({ hostId: deleteTarget.hostId })
		} catch (error) {
			toast.error('Could not delete host', { description: getDeleteHostErrorDescription(error) })
			return
		}
		setDeleteTarget(null)
		toast.success('Host deleted')
	}

	// Durable daemon registrations owned by the current user.
	const hosts = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					organization_id: hosts.organization_id,
					user_id: hosts.user_id,
					host_name: hosts.host_name,
					last_seen: hosts.last_seen,
					status: hosts.status,
					daemon_version: hosts.daemon_version,
					distribution: hosts.distribution,
					can_self_update: hosts.can_self_update,
					update_state: hosts.update_state,
					update_error: hosts.update_error,
					machine: hosts.machine,
					stats: hosts.stats,
					coding_agent_usage_limits: hosts.coding_agent_usage_limits,
					capabilities: hosts.capabilities,
				}))
				.orderBy(({ hosts }) => hosts.host_name, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)

	// Host aliases
	const { data: aliases } = useHostAliases()
	const upsertAlias = useUpsertHostAlias()
	const [editingHostId, setEditingHostId] = useState<string | null>(null)
	const [editValue, setEditValue] = useState('')

	const startEditing = useCallback(
		(hostId: string) => {
			const alias = aliases?.find((a) => a.hostId === hostId)
			setEditValue(alias?.displayName ?? '')
			setEditingHostId(hostId)
		},
		[aliases],
	)

	const saveAlias = useCallback(
		(hostId: string) => {
			const trimmed = editValue.trim()
			if (trimmed) {
				upsertAlias.mutate(
					{ hostId, displayName: trimmed },
					{
						onSuccess: () => toast.success('Host renamed'),
						onError: () => toast.error('Failed to rename host'),
					},
				)
			}
			setEditingHostId(null)
		},
		[editValue, upsertAlias],
	)

	const launchDaemon = useLaunchDaemon({
		syncMode: syncForceMode,
		tokenFactory: (hostId) => client.auth.daemon.token.create({ hostId }),
		userId: user?.id ?? userId ?? null,
		organizationId: organizationId ?? null,
	})

	const createLaunchTokenMutation = useMutation(
		api.auth.daemon.launchToken.create.mutationOptions({
			onSuccess: (data) => {
				setGeneratedToken(data)
				toast.success('Launch token generated')
			},
			onError: () => {
				toast.error('Failed to generate launch token')
			},
		}),
	)

	const launchCommand = generatedToken
		? buildDaemonLaunchCommand({
				remoteDaemonBuildType: import.meta.env.VITE_PUBLIC_REMOTE_DAEMON_BUILD_TYPE,
				token: generatedToken.token,
				uiBuildType: import.meta.env.VITE_PUBLIC_BUILD_TYPE,
			})
		: ''
	const statusNow = Date.now()
	const cliStage = useDaemonCliStage()
	const { targetDaemonVersion } = useTargetDaemonVersion()
	const requestHostUpdate = useRequestHostUpdate()

	const installCommand = targetDaemonVersion
		? `npm install -g @humanlayer/cli@${targetDaemonVersion}`
		: getHumanLayerCliInstallCommand(cliStage)

	const requestUpdate = (hostId: string) => {
		if (!targetDaemonVersion) return
		requestHostUpdate.mutate(
			{ hostId, version: targetDaemonVersion },
			{
				onSuccess: () => toast.success('Update requested'),
				onError: () => toast.error('Could not request the update. The daemon keeps its current version.'),
			},
		)
	}

	const hasOperationalHost =
		hosts.data?.some((host) => host.status === 'online' && !isAttachedSessionsOnly(host)) ?? false

	const handleCopyCommand = () => {
		if (launchCommand) {
			void copyToClipboard(launchCommand)
			toast.success('Copied to clipboard')
		}
	}

	return (
		<div className="space-y-6">
			{/* Daemon Hosts */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Daemon Hosts</h3>
				{!hosts.data?.length ? (
					<div className="flex items-center gap-2">
						<p className="text-sm text-muted-foreground">No daemon hosts.</p>
						{localDaemonEnabled && <LaunchDaemonEntryPoint onClick={() => setLaunchModalOpen(true)} />}
					</div>
				) : (
					<div className="space-y-2">
						{!hasOperationalHost && (
							<p className="text-sm text-muted-foreground">No host can start or continue work.</p>
						)}
						{hosts.data.map((host) => {
							const alias = aliases?.find((a) => a.hostId === host.host_id)
							const shortId = host.host_id?.substring(0, 8) ?? 'unknown'
							const isEditing = editingHostId === host.host_id
							const displayName =
								alias?.displayName ??
								(host.host_name && mirroredAgentLabel(host)
									? `${host.host_name} · ${mirroredAgentLabel(host)}`
									: (host.host_name ?? shortId))
							const status = getHostStatus(host, statusNow)
							const updateStalled = isUpdateStalled(host, statusNow)
							const updateState = updateStalled ? 'failed' : getHostUpdateState(host, targetDaemonVersion)
							const updatable = isHostUpdatable(host)
							const oldSelfUpdater = hasOldSelfUpdater(host)
							const stalledUpdateError = oldSelfUpdater
								? OLD_UPDATER_STALLED_UPDATE_ERROR
								: STALLED_UPDATE_ERROR
							const daemonVersion =
								host.daemon_version && host.daemon_version !== 'dev' ? host.daemon_version : null
							const statusPresentation = {
								online: { label: 'Online', dotClass: 'bg-green-500', textClass: 'text-green-600' },
								stale: { label: 'Stale', dotClass: 'bg-yellow-500', textClass: 'text-yellow-600' },
								offline: { label: 'Offline', dotClass: 'bg-red-500', textClass: 'text-red-600' },
							}[status]

							const pressure =
								status === 'online' && hostStatsEnabled
									? getHostPressure(host.stats, host.machine, statusNow)
									: null
							const usageLimits = host.coding_agent_usage_limits?.claude ?? null
							const updateControl = (
								<HostUpdateControl
									updateState={updateState}
									updatable={updatable}
									targetDaemonVersion={targetDaemonVersion}
									updateError={updateStalled ? stalledUpdateError : host.update_error}
									installCommand={installCommand}
									isRequesting={
										requestHostUpdate.isPending &&
										requestHostUpdate.variables?.hostId === host.host_id
									}
									activeSessionCount={host.stats?.sessionCount ?? 0}
									oldSelfUpdater={oldSelfUpdater}
									onRequestUpdate={() => requestUpdate(host.host_id)}
								/>
							)

							return (
								<div key={getOnlineHostKey(host)} className={hostRowClassName(pressure)}>
									<div
										className={`h-2 w-2 rounded-full shrink-0 ${pressure ? 'mt-1.5' : ''} ${statusPresentation.dotClass}`}
									/>
									{isEditing ? (
										<HostAliasEditor
											value={editValue}
											onChange={setEditValue}
											onSave={() => saveAlias(host.host_id)}
											onCancel={() => setEditingHostId(null)}
										/>
									) : pressure ? (
										<HostStatsRow
											hostId={host.host_id}
											stats={host.stats}
											machine={host.machine}
											pressure={pressure}
											daemonVersion={daemonVersion}
											displayName={alias?.displayName ?? host.host_name ?? shortId}
											shortId={shortId}
											statusLabel={statusPresentation.label}
											statusTextClass={statusPresentation.textClass}
											updateControl={updateControl}
											onEditAlias={() => startEditing(host.host_id)}
										/>
									) : (
										<>
											<div className="flex-1 min-w-0">
												<span className="text-sm font-medium">{displayName}</span>
												<span className="text-xs text-muted-foreground ml-2">({shortId})</span>
												{isAttachedSessionsOnly(host) && (
													<span className="text-xs text-muted-foreground ml-2">
														{mirroredAgentLabel(host) ?? 'Mirrored'} sessions only
													</span>
												)}
												{daemonVersion && (
													<span className="text-xs text-muted-foreground ml-2">
														{daemonVersion}
													</span>
												)}
											</div>
											<span className={`text-xs font-medium ${statusPresentation.textClass}`}>
												{statusPresentation.label}
											</span>
											{updateControl}
											<Button
												variant="ghost"
												size="icon"
												aria-label="Edit alias"
												className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
												onClick={() => startEditing(host.host_id)}
											>
												<Pencil className="h-3 w-3" />
											</Button>
										</>
									)}
									{canDeleteHost(host, statusNow) && (
										<Button
											variant="destructive"
											size="sm"
											aria-label="Delete host"
											onClick={() => setDeleteTarget({ hostId: host.host_id, displayName })}
										>
											<Trash2 className="size-3.5" />
										</Button>
									)}
									{usageLimits && <HostClaudeUsage limits={usageLimits} />}
								</div>
							)
						})}
					</div>
				)}
			</section>

			{/* Launch Token */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Launch Token</h3>
				<p className="text-sm text-muted-foreground mb-4">
					Generate a token to register daemons in non-interactive environments (CI, SSH, containers). Tokens
					expire after 24 hours.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => createLaunchTokenMutation.mutate({})}
					disabled={createLaunchTokenMutation.isPending}
				>
					{createLaunchTokenMutation.isPending ? 'Generating...' : 'Generate Launch Token'}
				</Button>
			</section>

			{generatedToken && (
				<section>
					<h3 className="text-sm font-semibold mb-2 text-muted-foreground">
						<Terminal className="h-3.5 w-3.5 inline-block mr-1" />
						Usage
					</h3>
					<div className="bg-muted/50 rounded-md p-3 font-mono text-xs break-all relative group">
						{launchCommand}
						<Button
							variant="ghost"
							size="icon"
							aria-label="Copy launch command"
							className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
							onClick={handleCopyCommand}
						>
							<Copy className="h-3 w-3" />
						</Button>
					</div>
					<p className="text-xs text-muted-foreground mt-1">
						Expires: {new Date(generatedToken.expiresAt).toLocaleString()}
					</p>
				</section>
			)}

			{isDesktop() && (
				<section>
					<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Advanced</h3>
					<LocalDaemonSetting />
				</section>
			)}

			{deleteTarget && (
				<HostDeleteDialog
					key={deleteTarget.hostId}
					open={true}
					displayName={deleteTarget.displayName}
					isPending={deleteHost.isPending}
					onConfirm={confirmDelete}
					onOpenChange={(open) => {
						if (!open && !deleteHost.isPending) setDeleteTarget(null)
					}}
				/>
			)}
			<LaunchDaemonModal
				open={launchModalOpen}
				onOpenChange={(open) => {
					setLaunchModalOpen(open)
					if (!open) {
						launchDaemon.reset()
					}
				}}
				state={launchDaemon.state}
				onLaunch={launchDaemon.launch}
				onReset={launchDaemon.reset}
				canLaunch={launchDaemon.canLaunch}
				isRunning={launchDaemon.isRunning}
			/>
		</div>
	)
}

function describeMachine(machine: HostMachine | null, daemonVersion: string | null): string[] {
	return [
		machine?.os,
		machine?.cpuModel,
		machine ? `${machine.cpuCores} cores` : undefined,
		machine ? formatGbShort(machine.memTotalBytes) : undefined,
		daemonVersion ? `daemon ${daemonVersion}` : undefined,
		machine ? formatUptime(machine.uptimeSec) : undefined,
	].filter((fact): fact is string => Boolean(fact))
}

function LoadStatBar({ pressure }: { pressure: HostPressure }) {
	if (pressure.load1 === undefined || pressure.loadPct === undefined) return null
	const sub =
		pressure.load5 === undefined || pressure.load15 === undefined
			? undefined
			: `1m ${pressure.load1.toFixed(1)} · 5m ${pressure.load5.toFixed(1)} · 15m ${pressure.load15.toFixed(1)}`
	return (
		<HostStatBar
			label="load"
			value={pressure.load1.toFixed(1)}
			pct={pressure.loadPct}
			level={pressure.loadLevel ?? 'ok'}
			sub={sub}
		/>
	)
}

function DiskStatBar({ pressure }: { pressure: HostPressure }) {
	if (pressure.diskUsedPct === undefined || pressure.diskFreeBytes === undefined) return null
	return (
		<HostStatBar
			label="disk"
			value={`${pressure.diskUsedPct}%`}
			pct={pressure.diskUsedPct}
			level={pressure.diskLevel ?? 'ok'}
			sub={`${formatGbShort(pressure.diskFreeBytes)} free`}
		/>
	)
}

function HostStatBars({ pressure, history }: { pressure: HostPressure; history: readonly HostStatsSample[] }) {
	const trendCaption = history.length > 1 ? `last ${formatDuration(historySpanMs(history))}` : undefined
	return (
		<div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
			<HostStatBar
				label="cpu"
				value={`${pressure.cpuPct}%`}
				pct={pressure.cpuPct}
				level={pressure.cpuLevel}
				spark={history.map((sample) => sample.cpuPct)}
				sparkCriticalAt={90}
				sub={trendCaption}
			/>
			<HostStatBar
				label="mem"
				value={`${pressure.memPct}%`}
				pct={pressure.memPct}
				level={pressure.memLevel}
				selfPct={pressure.memDaemonTreePct}
				spark={history.map((sample) => sample.memPct)}
				sparkCriticalAt={85}
				sub={
					<>
						{formatGb(pressure.memUsedBytes)} / {formatGb(pressure.memTotalBytes)}
						{pressure.memDaemonTreeBytes !== undefined && (
							<>
								{' · '}
								<span className="text-[var(--terminal-accent)]">
									{formatGb(pressure.memDaemonTreeBytes)} in agent sessions
								</span>
							</>
						)}
					</>
				}
			/>
			<LoadStatBar pressure={pressure} />
			<DiskStatBar pressure={pressure} />
		</div>
	)
}

function hostRowClassName(pressure: HostPressure | null): string {
	if (!pressure) return 'group flex flex-wrap items-center gap-3 bg-muted/50 rounded-md px-3 py-2'
	const memoryAccent = pressure.memLevel === 'crit' ? 'border-l-[var(--terminal-error)]' : 'border-l-transparent'
	return `group flex flex-wrap items-start gap-3 bg-muted/50 px-4 py-3 border-l-2 ${memoryAccent}`
}

function HostClaudeUsage({ limits }: { limits: ClaudeUsageLimits }) {
	return (
		<div className="basis-full pl-5">
			<UsageLimitBars limits={limits} />
			{limits.available && (
				<p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
					Claude{limits.subscription_type ? ` ${limits.subscription_type}` : ''} · checked{' '}
					{formatDistanceToNowStrict(limits.checked_at, { addSuffix: true })}
				</p>
			)}
		</div>
	)
}

function HostAliasEditor({
	value,
	onChange,
	onSave,
	onCancel,
}: {
	value: string
	onChange: (value: string) => void
	onSave: () => void
	onCancel: () => void
}) {
	return (
		<div className="flex items-center gap-1 flex-1">
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') onSave()
					if (e.key === 'Escape') onCancel()
				}}
				placeholder="Host name"
				className="h-7 text-sm"
				autoFocus
			/>
			<Button variant="ghost" size="icon" aria-label="Save alias" className="h-7 w-7 shrink-0" onClick={onSave}>
				<Check className="h-3 w-3" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Cancel editing"
				className="h-7 w-7 shrink-0"
				onClick={onCancel}
			>
				<X className="h-3 w-3" />
			</Button>
		</div>
	)
}

function HostStatsRow({
	hostId,
	stats,
	machine,
	pressure,
	daemonVersion,
	displayName,
	shortId,
	statusLabel,
	statusTextClass,
	updateControl,
	onEditAlias,
}: {
	hostId: string
	stats: HostStats | null
	machine: HostMachine | null
	pressure: HostPressure
	daemonVersion: string | null
	displayName: string
	shortId: string
	statusLabel: string
	statusTextClass: string
	updateControl: ReactNode
	onEditAlias: () => void
}) {
	const history = useHostStatsHistory(hostId, stats)

	const machineFacts = describeMachine(machine, daemonVersion)

	return (
		<div className="min-w-0 flex-1">
			<div className="flex items-center gap-2">
				<span className={`font-mono text-[10px] uppercase tracking-wider ${statusTextClass}`}>
					{statusLabel}
				</span>
				<span className="text-sm font-medium">{displayName}</span>
				<span className="font-mono text-xs text-muted-foreground">{shortId}</span>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Edit alias"
					className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
					onClick={onEditAlias}
				>
					<Pencil className="h-3 w-3" />
				</Button>
				<div className="ml-auto">{updateControl}</div>
			</div>
			{machineFacts.length > 0 && (
				<div className="mt-1 font-mono text-[11px] text-muted-foreground">{machineFacts.join(' · ')}</div>
			)}
			<HostStatBars pressure={pressure} history={history} />
			<HostActiveSessionsWired
				sessionCount={pressure.sessionCount}
				activeSessionIds={pressure.activeSessionIds}
			/>
			<HostTopProcesses groups={pressure.topProcesses} memTotalBytes={pressure.memTotalBytes} />
		</div>
	)
}
