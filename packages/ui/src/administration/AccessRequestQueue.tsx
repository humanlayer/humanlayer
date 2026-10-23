import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Button } from '@humanlayer/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import type { ReactNode } from 'react'

export type AccessRequestItem = RiptideApiOutputs['auth']['admin']['accessRequests']['list'][number]
export type AccessRequestStatus = 'pending' | 'archived'

export interface AccessRequestQueueProps {
	status: AccessRequestStatus
	onStatusChange: (status: AccessRequestStatus) => void
	requests: ReadonlyArray<AccessRequestItem>
	pendingCount?: number
	archivedCount?: number
	isLoading: boolean
	error?: unknown
	onRetry: () => void
	renderArtifact: (request: AccessRequestItem) => ReactNode
	renderPendingActions: (request: AccessRequestItem) => ReactNode
}

export function getAccessRequesterInitials(name: string | null, email: string): string {
	const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
	if (parts.length > 1) return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
	if (parts[0]) return parts[0].slice(0, 2).toUpperCase()
	return email.slice(0, 2).toUpperCase()
}

export function formatAccessRequestAge(iso: string, now = Date.now()): string {
	const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
	const months = Math.floor(days / 30)
	if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
	const years = Math.floor(months / 12)
	return `${years} year${years === 1 ? '' : 's'} ago`
}

export function AccessRequestQueue({
	status,
	onStatusChange,
	requests,
	pendingCount,
	archivedCount,
	isLoading,
	error,
	onRetry,
	renderArtifact,
	renderPendingActions,
}: AccessRequestQueueProps) {
	return (
		<div className="space-y-4">
			<Tabs value={status} onValueChange={(value) => onStatusChange(value as AccessRequestStatus)}>
				<TabsList>
					<TabsTrigger value="pending">Pending{pendingCount === undefined ? '' : ` (${pendingCount})`}</TabsTrigger>
					<TabsTrigger value="archived">Archived{archivedCount === undefined ? '' : ` (${archivedCount})`}</TabsTrigger>
				</TabsList>
			</Tabs>

			{isLoading ? (
				<div className="py-12 text-center text-xs text-muted-foreground">Loading…</div>
			) : error ? (
				<div className="space-y-3 py-12 text-center text-xs text-muted-foreground" role="alert">
					<p>Unable to load access requests.</p>
					<Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
				</div>
			) : requests.length === 0 ? (
				<div className="py-12 text-center text-xs text-muted-foreground">
					{status === 'pending' ? 'No pending access requests.' : 'No archived requests.'}
				</div>
			) : (
				<div className="overflow-x-auto border border-border">
					<table className="w-full min-w-[660px] border-collapse">
						<thead>
							<tr className="bg-muted/50">
								{['Requester', 'Requested artifact', 'Requested', 'Actions'].map((label) => (
									<th key={label} className="border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{requests.map((request) => (
								<tr key={request.id} className="border-b border-border last:border-b-0">
									<td className="px-3 py-2 align-middle text-sm">
										<div className="flex items-center gap-2">
											<div className="flex size-7 items-center justify-center bg-muted text-xs text-foreground">{getAccessRequesterInitials(request.requesterName, request.requesterEmail)}</div>
											<div className="flex min-w-0 flex-col"><span className="truncate text-foreground">{request.requesterEmail}</span>{request.requesterName ? <span className="truncate text-xs text-muted-foreground">{request.requesterName}</span> : null}</div>
										</div>
									</td>
									<td className="px-3 py-2 align-middle text-sm">{renderArtifact(request)}{request.taskName ? <div className="text-xs text-muted-foreground">{request.taskName}</div> : null}</td>
									<td className="px-3 py-2 align-middle text-sm text-muted-foreground">{formatAccessRequestAge(request.requestedAt)}</td>
									<td className="px-3 py-2 align-middle text-sm">{status === 'pending' ? renderPendingActions(request) : <span className="text-xs text-muted-foreground">—</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}
