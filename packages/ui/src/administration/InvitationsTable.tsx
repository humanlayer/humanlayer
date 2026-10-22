import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Input } from '@humanlayer/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ArrowUpDown, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { DataTable } from './DataTable'
import type { OrganizationInvitation } from './member'

export interface InvitationsTableProps {
	invitations: ReadonlyArray<OrganizationInvitation>
	isLoading: boolean
	error?: unknown
	isRevokePending: boolean
	onRetry: () => void
	onRevoke: (invitationId: string) => void
	onOpenInviteDialog: () => void
}

export function InvitationsTable({
	invitations,
	isLoading,
	error,
	isRevokePending,
	onRetry,
	onRevoke,
	onOpenInviteDialog,
}: InvitationsTableProps) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const statusFilter = (columnFilters.find((filter) => filter.id === 'state')?.value as string | undefined) ?? 'all'

	const columns: ColumnDef<OrganizationInvitation>[] = [
		{
			accessorKey: 'email',
			header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>Email<ArrowUpDown className="ml-2 h-4 w-4" /></Button>,
			cell: ({ row }) => <div className="pl-2">{row.getValue('email')}</div>,
		},
		{
			accessorKey: 'state',
			header: 'Status',
			filterFn: 'equalsString',
			cell: ({ row }) => {
				const state = row.getValue<string>('state')
				const variant = state === 'pending' ? 'outline' : state === 'accepted' ? 'default' : 'destructive'
				return <Badge variant={variant}>{state}</Badge>
			},
		},
		{
			accessorKey: 'createdAt',
			header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>Created<ArrowUpDown className="ml-2 h-4 w-4" /></Button>,
			cell: ({ row }) => {
				const createdAt = row.getValue<string>('createdAt')
				return <Tooltip><TooltipTrigger asChild><div className="cursor-help pl-2">{formatCompactRelativeTime(createdAt)}</div></TooltipTrigger><TooltipContent>{formatLocalAbsoluteTime(createdAt)}</TooltipContent></Tooltip>
			},
		},
		{
			accessorKey: 'expiresAt',
			header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>Expires<ArrowUpDown className="ml-2 h-4 w-4" /></Button>,
			cell: ({ row }) => {
				const expiresAt = row.getValue<string | undefined>('expiresAt')
				if (!expiresAt) return <div className="pl-2">Never</div>
				const date = new Date(expiresAt)
				return <div className="pl-2"><span className={date < new Date() ? 'text-destructive' : ''}>{date.toLocaleDateString()}</span></div>
			},
		},
		{
			id: 'actions',
			cell: ({ row }) => row.original.state === 'pending' ? <Button variant="ghost" size="icon" aria-label={`Revoke invitation for ${row.original.email}`} onClick={() => onRevoke(row.original.id)} disabled={isRevokePending}><Trash2 className="h-4 w-4" /></Button> : null,
		},
	]

	const setStatusFilter = (value: string) => {
		setColumnFilters((current) => {
			const withoutStatus = current.filter((filter) => filter.id !== 'state')
			return value === 'all' ? withoutStatus : [...withoutStatus, { id: 'state', value }]
		})
	}

	return (
		<Card className="p-4">
			<CardHeader><CardTitle>Invitations</CardTitle><CardDescription>Manage pending and completed invitations</CardDescription></CardHeader>
			<CardContent>
				<div className="space-y-4">
					<div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
						<div className="flex flex-1 flex-col gap-2 sm:flex-row">
							<Input placeholder="Search by email..." value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} className="sm:max-w-sm" />
							<Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by status" /></SelectTrigger><SelectContent>{['all', 'pending', 'accepted', 'revoked', 'expired'].map((state) => <SelectItem key={state} value={state}>{state === 'all' ? 'All Statuses' : `${state[0]?.toUpperCase()}${state.slice(1)}`}</SelectItem>)}</SelectContent></Select>
						</div>
						<Button onClick={onOpenInviteDialog}><Plus className="h-4 w-4" />Invite New User</Button>
					</div>
					{error ? <div className="space-y-3 py-8 text-center text-sm text-muted-foreground" role="alert"><p>Unable to load invitations.</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div> : <DataTable columns={columns} data={[...invitations]} sorting={sorting} onSortingChange={setSorting} columnFilters={columnFilters} onColumnFiltersChange={setColumnFilters} globalFilter={globalFilter} onGlobalFilterChange={setGlobalFilter} isLoading={isLoading} />}
				</div>
			</CardContent>
		</Card>
	)
}
