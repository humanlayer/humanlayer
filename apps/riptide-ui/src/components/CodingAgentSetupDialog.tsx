import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { AlertTriangle, MessageCircle } from 'lucide-react'
import { useCallback, useState } from 'react'

import { CodelayerDefaultsDisclosure } from '@/components/CodelayerDefaultsDisclosure'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SetupCommandList } from '@/components/provider-sign-in/SetupCommandList'
import { WiredProviderSignInCard } from '@/components/provider-sign-in/WiredProviderSignInCard'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useCodingAgentSetupStore } from '@/hooks/stores/codingAgentSetupStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useInAppSignInProvider } from '@/hooks/useInAppSignIn'
import type { CodingAgentSetupVariant } from '@/lib/coding-agent-setup'

function getHostInstruction(
	signInProvider: CodingAgentSetupVariant['signInProvider'],
	host: { name: string; isColocated: boolean },
): string {
	if (signInProvider) {
		return host.isColocated
			? 'This computer runs the sign-in and keeps the credentials.'
			: `${host.name} runs the sign-in and keeps the credentials.`
	}
	return host.isColocated
		? 'Run these commands on this computer before starting a session.'
		: `Run these commands on ${host.name}. That daemon host will run this session.`
}

export function CodingAgentSetupDialog() {
	const isOpen = useCodingAgentSetupStore((state) => state.isOpen)
	const target = useCodingAgentSetupStore((state) => state.target)
	const close = useCodingAgentSetupStore((state) => state.close)
	const isLaunchGuard = useCodingAgentSetupStore((state) => state.onContinue !== undefined)
	const setAcknowledged = useSettingsStore((state) => state.setCodingAgentSetupAcknowledged)
	const signInProvider = useInAppSignInProvider(target?.variant.signInProvider ?? null)
	const [dontShowAgain, setDontShowAgain] = useState(false)

	const handleCancel = useCallback(() => {
		useCodingAgentSetupStore.getState().onCancel?.()
		setDontShowAgain(false)
		close()
	}, [close])

	const handleContinue = useCallback(() => {
		if (dontShowAgain && target) {
			setAcknowledged(target.host.id, target.variant.id, true)
		}
		useCodingAgentSetupStore.getState().onContinue?.()
		setDontShowAgain(false)
		close()
	}, [close, dontShowAgain, setAcknowledged, target])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleContinue()
		},
		{ enabled: isOpen, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.CODELAYER_SETUP_DIALOG] },
		[isOpen, handleContinue],
	)
	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{ enabled: isOpen, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.CODELAYER_SETUP_DIALOG] },
		[isOpen, handleCancel],
	)

	if (!target) return null

	const { host, variant } = target
	const hostInstruction = getHostInstruction(signInProvider, host)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.CODELAYER_SETUP_DIALOG}
			isActive={isOpen}
			rootScopeDisabled={true}
			componentName="CodingAgentSetupDialog"
		>
			<Dialog open={isOpen} onOpenChange={(open) => (!open ? handleCancel() : undefined)}>
				<DialogContent
					className="overflow-hidden"
					style={{ width: 'min(92%, 42rem)', maxWidth: 'min(92%, 42rem)' }}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-[var(--terminal-warning)] text-base font-bold">
							<AlertTriangle className="h-4 w-4" />
							{variant.title}
						</DialogTitle>
						<DialogDescription>{variant.description}</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<p className="text-sm text-muted-foreground">{hostInstruction}</p>
							{signInProvider ? (
								<WiredProviderSignInCard
									hostId={host.id}
									provider={signInProvider}
									variant="card"
									onSignedIn={handleContinue}
								>
									<details className="text-xs text-muted-foreground">
										<summary className="cursor-pointer hover:text-foreground">
											Use the terminal instead
										</summary>
										<div className="mt-2">
											<SetupCommandList commands={variant.setupCommands} />
										</div>
									</details>
								</WiredProviderSignInCard>
							) : (
								<SetupCommandList commands={variant.setupCommands} />
							)}
						</div>
						{variant.provider === 'codex' && <CodelayerDefaultsDisclosure />}
						<a
							href="https://humanlayer.com/discord"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-accent hover:underline"
						>
							<MessageCircle className="h-4 w-4" />
							Report coding agent issues in Discord
						</a>
						{isLaunchGuard ? (
							<div className="flex items-center gap-2">
								<Checkbox
									id={`dont-show-coding-agent-setup-${variant.id}`}
									checked={dontShowAgain}
									onCheckedChange={(checked) => setDontShowAgain(checked === true)}
								/>
								<Label
									htmlFor={`dont-show-coding-agent-setup-${variant.id}`}
									className="cursor-pointer text-muted-foreground text-sm"
								>
									Don&apos;t show this again for {variant.providerName} on {host.name}
								</Label>
							</div>
						) : null}
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button
							variant="outline"
							onClick={handleContinue}
							className="border-[var(--terminal-warning)] text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)] hover:text-background focus-visible:border-[var(--terminal-warning)] focus-visible:ring-[var(--terminal-warning)]/50"
						>
							{variant.continueLabel}
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
									? '⌘+ENTER'
									: 'Ctrl+ENTER'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
