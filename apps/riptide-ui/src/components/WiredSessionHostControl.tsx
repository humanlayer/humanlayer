import { eq, useLiveQuery } from '@tanstack/react-db'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { WiredHostPressureBadge } from '@/components/host-stats/WiredHostPressureBadge'
import { useSync } from '@/components/providers/SyncProvider'
import { HostRenameControl } from '@/components/SessionInfoBar'
import { useHostAliases, useUpsertHostAlias } from '@/hooks/use-host-aliases'

/**
 * Host display name + rename popover for a session. Derives the name from the
 * session row, saved aliases, and online host records, so it can render both in
 * the breadcrumb (right sidebar collapsed) and in the sidebar header strip
 * (right sidebar open).
 */
export function WiredSessionHostControl({ sessionId, className }: { sessionId: string; className?: string }) {
	const { sessionsCollection, onlineHostsCollection } = useSync()
	const sessionQuery = useLiveQuery(
		(q) => q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId)),
		[sessionsCollection, sessionId],
	)
	const session = sessionQuery.data?.[0]

	const [renameOpen, setRenameOpen] = useState(false)
	const [renameValue, setRenameValue] = useState('')
	const upsertAlias = useUpsertHostAlias()
	const { data: aliases } = useHostAliases()
	const { data: onlineHostsForSession } = useLiveQuery(
		(q) => {
			if (!session?.host_id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					host_name: hosts.host_name,
				}))
				.where(({ hosts }) => eq(hosts.host_id, session.host_id))
		},
		[onlineHostsCollection, session?.host_id],
	)
	const hostDisplayName = useMemo(() => {
		if (!session?.host_id) return null
		const shortId = session.host_id.substring(0, 6)
		const alias = aliases?.find((a) => a.hostId === session.host_id)
		if (alias) return `${alias.displayName} (${shortId})`
		const hostRecord = onlineHostsForSession?.[0]
		if (hostRecord?.host_name) return `${hostRecord.host_name} (${shortId})`
		return shortId
	}, [session?.host_id, aliases, onlineHostsForSession])

	const handleOpenRename = useCallback(() => {
		const raw = hostDisplayName ?? ''
		const withoutSuffix = raw.replace(/\s*\([a-f0-9]+\)$/, '')
		setRenameValue(withoutSuffix)
		setRenameOpen(true)
	}, [hostDisplayName])
	const handleSaveRename = useCallback(() => {
		if (renameValue.trim() && session?.host_id) {
			upsertAlias.mutate({
				hostId: session.host_id,
				displayName: renameValue.trim(),
			})
			toast.success(`Host renamed to "${renameValue.trim()}"`)
		}
		setRenameOpen(false)
	}, [renameValue, session?.host_id, upsertAlias])

	return (
		<span className="inline-flex min-w-0 items-center gap-2">
			<HostRenameControl
				hostDisplayName={hostDisplayName}
				renameOpen={renameOpen}
				renameValue={renameValue}
				onOpenRename={handleOpenRename}
				onOpenChange={setRenameOpen}
				onRenameValueChange={setRenameValue}
				onSaveRename={handleSaveRename}
				className={className}
			/>
			{session?.host_id && hostDisplayName && (
				<WiredHostPressureBadge
					hostId={session.host_id}
					hostName={hostDisplayName.replace(/\s*\([a-f0-9]+\)$/, '')}
				/>
			)}
		</span>
	)
}
