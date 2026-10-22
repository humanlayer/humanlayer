import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { Check, Circle, X } from 'lucide-react'
import { useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useDismissOnboardingAction } from '@/hooks/useDismissOnboardingAction'

import { useProjectOnboardingState } from './CreateFirstProjectStep'
import { getOnboardingProgress, type CollaborationProgress } from './onboarding-progress'
import { OnboardingChecklist } from './OnboardingChecklist'
import { useGitHubOnboardingProgress } from './useGitHubOnboardingProgress'

interface SidebarOnboardingProps {
	onCreateTask: (projectId?: string) => void
	onCreateWorkflowTask: (projectId?: string) => void
}

const STEP_LABELS = {
	agent: 'Connect a coding agent',
	task: 'Run first task',
	workflow: 'Run a workflow',
	collaboration: 'Collaborate on a plan document',
	github: 'Connect GitHub',
} as const

export function SidebarOnboarding({ onCreateTask, onCreateWorkflowTask }: SidebarOnboardingProps) {
	const [open, setOpen] = useState(false)
	const expectedScope = useSettingsStore((state) => state._serverSettingsRequestedScope)
	const dismissOnboarding = useDismissOnboardingAction()
	const codingAgentReady = useAgentConnectionsStore((state) =>
		state.agentConnections.some((connection) => connection.status === 'ready'),
	)
	const firstTaskCompletedAt = useSettingsStore((state) => state.firstTaskCompletedAt)
	const firstStructuredWorkflowCompletedAt = useSettingsStore((state) => state.firstStructuredWorkflowCompletedAt)
	const firstInboundCommentReceivedAt = useSettingsStore((state) => state.firstInboundCommentReceivedAt)
	const appliedScope = useSettingsStore((state) => state._serverSettingsAppliedScope)
	const projectOnboarding = useProjectOnboardingState()
	const github = useGitHubOnboardingProgress()
	const collaboration: CollaborationProgress =
		expectedScope === null || appliedScope !== expectedScope
			? 'pending'
			: firstInboundCommentReceivedAt === null
				? 'incomplete'
				: 'complete'
	const progress = getOnboardingProgress({
		deviceSetupOnly: false,
		hasReadyAgent: codingAgentReady,
		firstTaskCompletedAt,
		firstStructuredWorkflowCompletedAt,
		collaboration,
		github,
	})
	const steps: Array<{ id: string; label: string; complete: boolean }> = progress.steps.map((step) => ({
		...step,
		label: STEP_LABELS[step.id],
	}))
	if (projectOnboarding.enabled) {
		steps.splice(1, 0, {
			id: 'project',
			label: 'Create a project',
			complete: projectOnboarding.hasUsableProject,
		})
	}
	const remaining = steps.filter((step) => !step.complete).length
	return (
		<>
			<div className="pb-2">
				<div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
					<button
						type="button"
						className="flex flex-1 items-center gap-2 text-left"
						onClick={() => setOpen(true)}
					>
						<span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-accent">
							Get set up
						</span>
						<span className="bg-sidebar-accent px-1.5 text-[10px] tabular-nums text-muted-foreground">
							{remaining}
						</span>
					</button>
					<Button
						aria-label="Dismiss onboarding"
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() => dismissOnboarding()}
					>
						<X aria-hidden className="size-3" />
					</Button>
				</div>
				<button
					type="button"
					className="w-full px-3 py-1 text-left hover:bg-sidebar-accent"
					onClick={() => setOpen(true)}
				>
					{steps.map((step) => (
						<span
							key={step.id}
							className="flex items-center gap-2 py-0.5 text-xs text-sidebar-foreground/70"
						>
							{step.complete ? (
								<Check className="size-3 text-[var(--terminal-success)]" />
							) : (
								<Circle className="size-3" />
							)}
							<span className={step.complete ? 'line-through' : undefined}>{step.label}</span>
						</span>
					))}
				</button>
			</div>

			<HotkeyScopeBoundary scope={HOTKEY_SCOPES.ONBOARDING_DIALOG} isActive={open} rootScopeDisabled>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogContent
						className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
						onOpenAutoFocus={(event) => event.preventDefault()}
					>
						<DialogHeader>
							<DialogTitle>Get set up</DialogTitle>
							<DialogDescription>
								Check this device and finish the first steps in HumanLayer.
							</DialogDescription>
						</DialogHeader>
						<OnboardingChecklist
							onCreateTask={(projectId) => {
								setOpen(false)
								onCreateTask(projectId)
							}}
							onCreateWorkflowTask={(projectId) => {
								setOpen(false)
								onCreateWorkflowTask(projectId)
							}}
						/>
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
}
