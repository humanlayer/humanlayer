import { Button } from '@humanlayer/ui/components/button'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useDismissOnboardingAction } from '@/hooks/useDismissOnboardingAction'

import { WiredOtherHostsSignIn } from './agent-sign-in/WiredOtherHostsSignIn'
import { WiredThisComputerSignIn } from './agent-sign-in/WiredThisComputerSignIn'

export function AgentSignInSettingsSection() {
	const dismissedAt = useSettingsStore((state) => state.onboardingDismissedAt)
	const dismissOnboarding = useDismissOnboardingAction()
	return (
		<div className="space-y-8">
			<p className="text-sm leading-6 text-muted-foreground">
				Each host signs in to Claude and ChatGPT on its own and keeps the credentials. Sessions on a host use
				that host&apos;s sign-in.
			</p>
			<WiredThisComputerSignIn />
			<WiredOtherHostsSignIn />
			{dismissedAt !== null && (
				<div className="flex items-center justify-between gap-4 bg-foreground/[0.035] px-4 py-3">
					<div>
						<h2 className="text-sm font-medium">Onboarding checklist</h2>
						<p className="text-xs text-muted-foreground">You dismissed it from the sidebar.</p>
					</div>
					<Button variant="secondary" size="sm" onClick={() => dismissOnboarding(false)}>
						Show in sidebar
					</Button>
				</div>
			)}
		</div>
	)
}
