import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@humanlayer/ui/components/item'
import { cn } from '@humanlayer/ui/lib/utils'
import { Link } from '@tanstack/react-router'
import { ChevronRight, UserPlus } from 'lucide-react'

interface CreateOrganizationLinkProps {
	compact?: boolean
	className?: string
	disabled?: boolean
}

export function CreateOrganizationLink({ compact, className, disabled }: CreateOrganizationLinkProps) {
	return (
		<Item
			variant="outline"
			size="sm"
			asChild
			className={cn(className, disabled && 'opacity-50 pointer-events-none')}
		>
			<Link to="/auth/organizations/create">
				<ItemMedia>
					<UserPlus className="size-5" />
				</ItemMedia>
				<ItemContent>
					<ItemTitle className="uppercase">{compact ? 'Create' : 'Create an Organization'}</ItemTitle>
				</ItemContent>
				<ItemActions>
					<ChevronRight className="size-4" />
				</ItemActions>
			</Link>
		</Item>
	)
}
