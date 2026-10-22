import { Button } from '@humanlayer/ui/components/button'
import { CompanyLogo } from '@humanlayer/ui/components/company-logo'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@humanlayer/ui/components/item'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { cn } from '@humanlayer/ui/lib/utils'
import { Building2 } from 'lucide-react'

interface InvitationListItemProps {
	invitation: {
		id: string
		token: string
		organization?: {
			name?: string
			domains?: string[]
		} | null
	}
	onAccept: (token: string) => void
	isAccepting?: boolean
	disabled?: boolean
}

export function InvitationListItem({ invitation, onAccept, isAccepting, disabled }: InvitationListItemProps) {
	return (
		<Item variant="outline" size="sm" className={cn('relative', disabled && 'opacity-50')}>
			<ItemMedia>
				{invitation.organization?.domains?.[0] ? (
					<CompanyLogo domain={invitation.organization.domains[0]} className="size-5" />
				) : (
					<Building2 className="size-5" />
				)}
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{invitation.organization?.name || 'Unknown Organization'}</ItemTitle>
			</ItemContent>
			<ItemActions>
				<Button size="sm" onClick={() => onAccept(invitation.token)} disabled={isAccepting || disabled}>
					{isAccepting ? <SyncGridAnimation variant="snake" size="sm" speed={120} /> : 'Accept'}
				</Button>
			</ItemActions>
		</Item>
	)
}
