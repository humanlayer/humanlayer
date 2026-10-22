import { Button } from '@humanlayer/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { AgentSetupStep } from './AgentSetupStep'
import { ConnectGitHubStep } from './ConnectGitHubStep'
import { CreateFirstProjectStep, OnboardingProjectPicker, useProjectOnboardingState } from './CreateFirstProjectStep'
import type { CollaborationProgress, GitHubProgress } from './onboarding-progress'
import { PlanDocumentCollaborationStep } from './PlanDocumentCollaborationStep'
import { useGitHubOnboardingProgress } from './useGitHubOnboardingProgress'

interface OnboardingChecklistProps {
	onCreateTask: (projectId?: string) => void
	onCreateWorkflowTask?: (projectId?: string) => void
	createTaskAction?: ReactNode
	deviceSetupOnly?: boolean
}

type OnboardingStep = 'agent' | 'project' | 'task' | 'workflow' | 'collaboration' | 'github'

function getNextIncompleteStep({
	deviceSetupOnly,
	hasReadyAgent,
	firstTaskCompletedAt,
	firstStructuredWorkflowCompletedAt,
	projectsEnabled,
	hasUsableProject,
	collaboration,
	github,
}: {
	deviceSetupOnly: boolean | undefined
	hasReadyAgent: boolean
	firstTaskCompletedAt: number | null
	firstStructuredWorkflowCompletedAt: number | null
	projectsEnabled: boolean
	hasUsableProject: boolean
	collaboration: CollaborationProgress
	github: GitHubProgress
}): OnboardingStep | null {
	if (deviceSetupOnly || !hasReadyAgent) return 'agent'
	if (projectsEnabled && !hasUsableProject) return 'project'
	if (firstTaskCompletedAt === null) return 'task'
	if (firstStructuredWorkflowCompletedAt === null) return 'workflow'
	if (collaboration === 'incomplete') return 'collaboration'
	if (github === 'incomplete') return 'github'
	return null
}
/** The GitHub step is the last one, and device setup has its own short list. */
const connectGitHubRows = (github: GitHubProgress, deviceSetupOnly: boolean | undefined): ChecklistRow[] =>
	deviceSetupOnly || github === 'hidden'
		? []
		: [{ id: 'github', title: 'Connect GitHub', done: github === 'complete', body: <ConnectGitHubStep /> }]

export function OnboardingChecklist({
	onCreateTask,
	onCreateWorkflowTask,
	createTaskAction,
	deviceSetupOnly,
}: OnboardingChecklistProps) {
	const expectedScope = useSettingsStore((state) => state._serverSettingsRequestedScope)
	return (
		<OnboardingChecklistContent
			key={expectedScope ?? 'settings-pending'}
			onCreateTask={onCreateTask}
			onCreateWorkflowTask={onCreateWorkflowTask}
			createTaskAction={createTaskAction}
			deviceSetupOnly={deviceSetupOnly}
			expectedScope={expectedScope}
		/>
	)
}

interface OnboardingChecklistContentProps extends OnboardingChecklistProps {
	expectedScope: string | null
}

interface ChecklistRow {
	readonly id: string
	readonly title: string
	readonly done: boolean
	readonly body: ReactNode
}

function OnboardingChecklistContent({
	onCreateTask,
	onCreateWorkflowTask,
	createTaskAction,
	deviceSetupOnly,
	expectedScope,
}: OnboardingChecklistContentProps) {
	const hasReadyAgent = useAgentConnectionsStore((state) =>
		state.agentConnections.some((item) => item.status === 'ready'),
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
	const initialOpenStep = getNextIncompleteStep({
		deviceSetupOnly,
		hasReadyAgent,
		firstTaskCompletedAt,
		firstStructuredWorkflowCompletedAt,
		projectsEnabled: projectOnboarding.enabled,
		hasUsableProject: projectOnboarding.hasUsableProject,
		collaboration,
		github,
	})
	const [openSteps, setOpenSteps] = useState(() => new Set<string>(initialOpenStep === null ? [] : [initialOpenStep]))
	const [createdProject, setCreatedProject] = useState<(typeof projectOnboarding.projects)[number] | null>(null)
	const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)
	const availableProjects =
		createdProject && !projectOnboarding.projects.some((project) => project.id === createdProject.id)
			? [createdProject, ...projectOnboarding.projects]
			: projectOnboarding.projects
	const selectedProjectId =
		chosenProjectId ??
		createdProject?.id ??
		(availableProjects.length === 1 ? availableProjects[0]?.id : null) ??
		null
	const initialConnectionCompleted = useRef(hasReadyAgent)
	const toggleStep = (step: string) => {
		setOpenSteps((current) => {
			const next = new Set(current)
			if (next.has(step)) next.delete(step)
			else next.add(step)
			return next
		})
	}

	const rows: ChecklistRow[] = deviceSetupOnly
		? []
		: [
				{
					id: 'task',
					title: 'Run your first task',
					done: firstTaskCompletedAt !== null,
					body: (
						<div className="space-y-3">
							<p>
								A task is a shared home for work. It holds coding-agent sessions and shared artifacts,
								like plans and design documents, that teams can collaborate on together. Start with a
								focused task and one session, or choose a workflow to guide the work through structured
								steps.
							</p>
							{projectOnboarding.enabled && availableProjects.length > 0 && (
								<OnboardingProjectPicker
									projects={availableProjects}
									selectedProjectId={selectedProjectId}
									onSelectProject={setChosenProjectId}
								/>
							)}
							{createTaskAction ?? (
								<Button
									disabled={
										projectOnboarding.enabled &&
										availableProjects.length > 0 &&
										selectedProjectId === null
									}
									onClick={() => onCreateTask(selectedProjectId ?? undefined)}
								>
									Create first task
								</Button>
							)}
						</div>
					),
				},
				{
					id: 'workflow',
					title: 'Try a structured workflow',
					done: firstStructuredWorkflowCompletedAt !== null,
					body: (
						<div className="space-y-3">
							<p>
								Use Research, Plan, and Implement when the work needs more context and a written plan.
							</p>
							<Button
								disabled={
									projectOnboarding.enabled &&
									availableProjects.length > 0 &&
									selectedProjectId === null
								}
								onClick={() => (onCreateWorkflowTask ?? onCreateTask)(selectedProjectId ?? undefined)}
							>
								Create a workflow task
							</Button>
						</div>
					),
				},
			]
	if (!deviceSetupOnly && projectOnboarding.enabled) {
		rows.unshift({
			id: 'project',
			title: 'Create your first project',
			done: projectOnboarding.hasUsableProject || createdProject !== null,
			body: (
				<CreateFirstProjectStep
					state={projectOnboarding}
					onCreateTask={() => onCreateTask()}
					selectedProjectId={selectedProjectId}
					onSelectProject={setChosenProjectId}
					onProjectCreated={(project) => {
						setCreatedProject(project)
						setChosenProjectId(project.id)
						setOpenSteps((current) => {
							const next = new Set(current)
							next.delete('project')
							next.add('task')
							return next
						})
					}}
				/>
			),
		})
	}
	if (!deviceSetupOnly && collaboration !== 'pending') {
		rows.push({
			id: 'collaboration',
			title: 'Collaborate on a plan document',
			done: collaboration === 'complete',
			body: (
				<PlanDocumentCollaborationStep
					expanded={openSteps.has('collaboration')}
					onCreateRpiTask={() => (onCreateWorkflowTask ?? onCreateTask)(selectedProjectId ?? undefined)}
				/>
			),
		})
	}
	rows.push(...connectGitHubRows(github, deviceSetupOnly))

	return (
		<div className="border-y">
			<AgentSetupStep
				open={openSteps.has('agent')}
				onToggle={() => toggleStep('agent')}
				onAgentReady={() => {
					if (deviceSetupOnly || firstTaskCompletedAt !== null || initialConnectionCompleted.current) return
					initialConnectionCompleted.current = true
					const nextStep =
						projectOnboarding.enabled && !projectOnboarding.hasUsableProject ? 'project' : 'task'
					setOpenSteps((current) => new Set([...current, nextStep]))
				}}
			/>

			{rows.map((row) => (
				<Collapsible
					key={row.id}
					open={openSteps.has(row.id)}
					onOpenChange={() => toggleStep(row.id)}
					className="border-t"
				>
					<CollapsibleTrigger className="flex w-full items-center gap-3 py-4 text-left">
						{row.done ? (
							<Check className="size-4 text-[var(--terminal-success)]" />
						) : (
							<Circle className="size-4 text-muted-foreground" />
						)}
						<span
							className={cn(
								'flex-1 text-sm font-medium',
								row.done && 'line-through text-muted-foreground',
							)}
						>
							{row.title}
						</span>
						<ChevronRight
							className={cn('size-4 transition-transform', openSteps.has(row.id) && 'rotate-90')}
						/>
					</CollapsibleTrigger>
					<CollapsibleContent className="mb-4 bg-accent/5 px-5 py-4 text-sm leading-6 text-muted-foreground">
						{row.body}
					</CollapsibleContent>
				</Collapsible>
			))}
		</div>
	)
}
