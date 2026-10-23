import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Separator } from '@humanlayer/ui/components/separator'
import { cn } from '@humanlayer/ui/lib/utils'
import { Power, RotateCcw, Trash2 } from 'lucide-react'

import type { OrganizationMember } from '../member'
import { getMemberDisplayName, getMemberInitials } from '../member'
import { MemberStatusBadge } from './MemberStatusBadge'

interface MemberDetailsProfileProps {
	user: OrganizationMember
}
export function MemberDetailsProfile({ user }: MemberDetailsProfileProps) {
	const inactive = user.status === 'inactive'
	const name = getMemberDisplayName(user)
	return (
		<>
			<div className="flex items-center space-x-4">
				<Avatar className={cn('h-12 w-12', inactive && 'opacity-60 grayscale')}>
					<AvatarImage src={user.profilePictureUrl ?? ''} alt={name} />
					<AvatarFallback>{getMemberInitials(user)}</AvatarFallback>
				</Avatar>
				<div>
					<h3 className={cn('font-semibold', inactive && 'text-muted-foreground')}>{name}</h3>
					<p className="text-sm text-muted-foreground">{user.email}</p>
				</div>
			</div>
			{inactive && (
				<div className="border border-muted-foreground/30 bg-muted/20 p-3 text-sm text-muted-foreground">
					<Badge variant="outline" className="mb-2 border-muted-foreground/50 text-muted-foreground">
						Deactivated
					</Badge>
					<p>This user is not counted for billing and cannot log in to this organization.</p>
				</div>
			)}
			<Separator />
		</>
	)
}

interface MemberDetailsInformationProps {
	user: OrganizationMember
	statsLoading: boolean
	sessions: number
	comments: number
	activeWeeks: number
	rolePending: boolean
	onChangeRole: () => void
}
export function MemberDetailsInformation({
	user,
	statsLoading,
	sessions,
	comments,
	activeWeeks,
	rolePending,
	onChangeRole,
}: MemberDetailsInformationProps) {
	const metric = (value: number) => (statsLoading ? 'Loading...' : value)
	return (
		<div className="space-y-4">
			<div>
				<p className="text-sm font-medium">Membership Status</p>
				<div className="mt-1">
					<MemberStatusBadge status={user.status} />
				</div>
			</div>
			<div>
				<p className="text-sm font-medium">Role</p>
				<div className="flex items-center gap-2 mt-1">
					<Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
					<Button variant="outline" size="sm" onClick={onChangeRole} disabled={rolePending}>
						{rolePending ? 'Updating...' : `Change to ${user.role === 'admin' ? 'Member' : 'Admin'}`}
					</Button>
				</div>
			</div>
			<div>
				<p className="text-sm font-medium">Member Since</p>
				<p className="text-sm text-muted-foreground mt-1">
					{new Date(user.createdAt).toLocaleDateString('en-US', {
						year: 'numeric',
						month: 'long',
						day: 'numeric',
					})}
				</p>
			</div>
			<div>
				<p className="text-sm font-medium">User ID</p>
				<p className="text-sm text-muted-foreground mt-1 font-mono">{user.id}</p>
			</div>
			<div>
				<p className="text-sm font-medium">Sessions</p>
				<p className="text-sm text-muted-foreground mt-1">{metric(sessions)}</p>
			</div>
			<div>
				<p className="text-sm font-medium">Comments</p>
				<p className="text-sm text-muted-foreground mt-1">{metric(comments)}</p>
			</div>
			<div>
				<p className="text-sm font-medium">Active Weeks</p>
				<p className="text-sm text-muted-foreground mt-1">{metric(activeWeeks)}</p>
			</div>
		</div>
	)
}

interface MemberLifecycleActionsProps {
	inactive: boolean
	reactivatePending: boolean
	deactivatePending: boolean
	removePending: boolean
	onReactivate: () => void
	onDeactivate: () => void
	onRemove: () => void
}
export function MemberLifecycleActions({
	inactive,
	reactivatePending,
	deactivatePending,
	removePending,
	onReactivate,
	onDeactivate,
	onRemove,
}: MemberLifecycleActionsProps) {
	return (
		<div className="space-y-2 pt-4">
			{inactive ? (
				<Button variant="outline" className="w-full" onClick={onReactivate} disabled={reactivatePending}>
					<RotateCcw className="h-4 w-4 mr-2" />
					{reactivatePending ? 'Reactivating...' : 'Reactivate User'}
				</Button>
			) : (
				<Button variant="destructive" className="w-full" onClick={onDeactivate} disabled={deactivatePending}>
					<Power className="h-4 w-4 mr-2" />
					Deactivate User
				</Button>
			)}
			<Button variant="destructive" className="w-full" onClick={onRemove} disabled={removePending}>
				<Trash2 className="h-4 w-4 mr-2" />
				Remove from Organization
			</Button>
		</div>
	)
}
