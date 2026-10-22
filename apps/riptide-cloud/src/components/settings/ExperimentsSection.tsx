import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'

import { env } from '@/env'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

export function ExperimentsSection() {
	const billingPreviewEnabled = useSettingsStore((s) => s.billingPreviewEnabled)
	const setBillingPreviewEnabled = useSettingsStore((s) => s.setBillingPreviewEnabled)

	return (
		<section>
			<div className="mb-4">
				<h2 className="text-base font-semibold">Experiments</h2>
				<p className="text-sm text-muted-foreground">
					Opt-in previews for upcoming features. These toggles are local to this browser and do not affect
					other users.
				</p>
			</div>
			<div className="space-y-2">
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					{env.billingEnforcementEnabled ? (
						<div className="w-10" />
					) : (
						<Switch
							checked={billingPreviewEnabled}
							onCheckedChange={setBillingPreviewEnabled}
							className="mt-0.5"
						/>
					)}
					<Label className="text-sm font-medium">Billing Preview</Label>
					<p className="text-sm text-muted-foreground">
						{env.billingEnforcementEnabled
							? 'Billing is required in this environment and is always visible to admins.'
							: 'Show the dedicated Billing section on this settings page.'}
					</p>
				</div>
			</div>
		</section>
	)
}
