import { CompanyLogo } from '@humanlayer/ui/components/company-logo'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@humanlayer/ui/components/item'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { cn } from '@humanlayer/ui/lib/utils'
import { Building2 } from 'lucide-react'

interface OrganizationListItemProps {
	organization: {
		organizationId: string
		organizationName: string
		role?: string
	}
	domains?: string[]
	onSelect: (organizationId: string) => void
	isLoading?: boolean
	disabled?: boolean
}

export function OrganizationListItem({
	organization,
	domains,
	onSelect,
	isLoading,
	disabled,
}: OrganizationListItemProps) {
	return (
		<Item
			variant="outline"
			size="sm"
			className={cn('cursor-pointer group', disabled && 'opacity-50 pointer-events-none')}
			onClick={() => onSelect(organization.organizationId)}
		>
			<ItemMedia>
				<div className="flex size-6 items-center justify-center">
					{domains?.[0] ? <CompanyLogo domain={domains[0]} /> : <Building2 className="text-foreground" />}
				</div>
			</ItemMedia>
			<ItemContent className="flex flex-row items-center justify-between">
				<ItemTitle>{organization.organizationName}</ItemTitle>
				<div className="text-xs text-muted-foreground group-hover:text-background">
					{organization.role || 'member'}
				</div>
			</ItemContent>
			{isLoading && <SyncGridAnimation variant="snake" size="sm" speed={120} className="ml-2" />}
		</Item>
	)
}
