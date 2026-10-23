import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { Building2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useSwitchOrganization } from '@/hooks/useSwitchOrganization'
import { captureException } from '@/integrations/sentry/sentry'

export function SwitchOrganizationPrompt({
	workosOrganizationId,
	organizationName,
}: {
	workosOrganizationId: string
	organizationName: string
}) {
	const switchToOrganization = useSwitchOrganization()
	const [switching, setSwitching] = useState(false)

	const handleSwitch = async () => {
		setSwitching(true)
		try {
			await switchToOrganization({ organizationId: workosOrganizationId })
		} catch (error) {
			console.error('Failed to switch org:', error)
			captureException(error instanceof Error ? error : new Error('Failed to switch organization'), {
				action: 'switchOrganization',
				workosOrganizationId,
			})
			toast.error('Failed to switch organization')
			setSwitching(false)
		}
	}

	return (
		<div className="flex items-center justify-center h-full p-6">
			<Card className="p-8 text-center max-w-md mx-auto">
				<Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
				<h2 className="font-mono uppercase tracking-wider mb-2">Switch Organization</h2>
				<p className="text-sm text-muted-foreground mb-6">
					This artifact lives in <span className="text-foreground font-medium">{organizationName}</span>.
					Switch to that organization to view it.
				</p>
				<Button onClick={handleSwitch} disabled={switching} className="w-full">
					{switching ? 'Switching…' : `Switch to ${organizationName}`}
				</Button>
			</Card>
		</div>
	)
}
