import { Badge } from '@humanlayer/ui/components/badge'

import type { OrganizationMember } from '../member'

export function MemberStatusBadge({ status }: Pick<OrganizationMember, 'status'>) {
	return (
		<Badge
			variant={status === 'active' ? 'default' : 'outline'}
			className={status === 'inactive' ? 'border-muted-foreground/50 text-muted-foreground' : undefined}
		>
			{status === 'active' ? 'Active' : 'Inactive'}
		</Badge>
	)
}
