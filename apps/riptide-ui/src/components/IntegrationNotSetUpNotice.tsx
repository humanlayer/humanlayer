import { CircleSlash } from 'lucide-react'
import type { FC } from 'react'

import { integrationNotSetUpMessage } from '@/lib/integration-capabilities'

export interface IntegrationNotSetUpNoticeProps {
	name: string
}

/**
 * Shown in place of the connect prompt when this deployment has no keys for an integration.
 * It has no button: connecting cannot work until whoever runs the deployment adds the keys.
 */
export const IntegrationNotSetUpNotice: FC<IntegrationNotSetUpNoticeProps> = ({ name }) => (
	<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
		<div className="flex items-start gap-3">
			<div className="mt-0.5 rounded-md bg-muted p-2">
				<CircleSlash aria-hidden className="size-4 text-muted-foreground" />
			</div>
			<p className="flex-1 pt-1.5 text-xs text-muted-foreground">{integrationNotSetUpMessage(name)}</p>
		</div>
	</div>
)
