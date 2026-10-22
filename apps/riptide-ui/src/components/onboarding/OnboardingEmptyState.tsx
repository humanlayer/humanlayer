import { Button } from '@humanlayer/ui/components/button'
import { ArrowRight } from 'lucide-react'

import { OnboardingChecklist } from './OnboardingChecklist'

interface OnboardingEmptyStateProps {
	onCreateTask: (projectId?: string) => void
	onCreateWorkflowTask: (projectId?: string) => void
}

export function OnboardingEmptyState({ onCreateTask, onCreateWorkflowTask }: OnboardingEmptyStateProps) {
	return (
		<div className="flex h-full min-h-0 justify-center overflow-auto bg-gradient-to-b from-accent/10 via-background to-background px-6 py-12">
			<div className="w-full max-w-2xl">
				<div className="mb-7 max-w-xl">
					<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Get set up</p>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Start with a working coding agent
					</h1>
					<p className="mt-3 text-sm leading-6 text-muted-foreground">
						We check this device before your first task, then keep the next steps close at hand.
					</p>
				</div>
				<OnboardingChecklist onCreateTask={onCreateTask} onCreateWorkflowTask={onCreateWorkflowTask} />
				<div className="mt-6 flex justify-end">
					<Button size="sm" onClick={() => onCreateTask()}>
						Create first task
						<ArrowRight className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	)
}
