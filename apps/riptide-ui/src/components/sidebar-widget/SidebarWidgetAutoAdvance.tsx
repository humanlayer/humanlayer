import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import type { FC } from 'react'

/**
some of these can be optional since task screen
determines which to display based on workflow type and 
worktree timing (now / later / never)
*/
export interface SidebarWidgetAutoAdvanceProps {
	questionsToResearchEnabled: boolean
	onQuestionsToResearchChange?: (enabled: boolean) => void
	researchToDesignEnabled: boolean
	onResearchToDesignChange?: (enabled: boolean) => void
	planToWorktreeEnabled: boolean
	planAutoAdvanceLabel?: string
	planAutoAdvanceTitle?: string
	onPlanToWorktreeChange?: (enabled: boolean) => void
	worktreeToImplementationEnabled: boolean
	onWorktreeToImplementationChange?: (enabled: boolean) => void
	implementationToPrEnabled: boolean
	onImplementationToPrChange?: (enabled: boolean) => void
	isDisabled?: boolean
}

interface AutoAdvanceToggleProps {
	id: string
	label: string
	title: string
	checked: boolean
	onChange: (enabled: boolean) => void
	isDisabled?: boolean
}

const AutoAdvanceToggle: FC<AutoAdvanceToggleProps> = ({ id, label, title, checked, onChange, isDisabled }) => (
	<div className="flex items-center justify-between gap-4" title={title}>
		<Label htmlFor={id} className="text-xs font-mono">
			{label}
		</Label>
		<Switch id={id} checked={checked} onCheckedChange={onChange} disabled={isDisabled} />
	</div>
)

export const SidebarWidgetAutoAdvance: FC<SidebarWidgetAutoAdvanceProps> = ({
	questionsToResearchEnabled,
	onQuestionsToResearchChange,
	researchToDesignEnabled,
	onResearchToDesignChange,
	planToWorktreeEnabled,
	planAutoAdvanceLabel = 'Plan → Worktree',
	planAutoAdvanceTitle = 'Automatically set up worktree when plan session completes',
	onPlanToWorktreeChange,
	worktreeToImplementationEnabled,
	onWorktreeToImplementationChange,
	implementationToPrEnabled,
	onImplementationToPrChange,
	isDisabled,
}) => {
	return (
		<div className="space-y-1.5 p-2 overflow-y-auto h-full font-mono">
			{onQuestionsToResearchChange && (
				<AutoAdvanceToggle
					id="aa-questions-to-research"
					label="Questions → Research"
					title="Automatically launch research when questions session completes"
					checked={questionsToResearchEnabled}
					onChange={onQuestionsToResearchChange}
					isDisabled={isDisabled}
				/>
			)}
			{onResearchToDesignChange && (
				<AutoAdvanceToggle
					id="aa-research-to-design"
					label="Research → Design"
					title="Automatically launch design discussion when research session completes"
					checked={researchToDesignEnabled}
					onChange={onResearchToDesignChange}
					isDisabled={isDisabled}
				/>
			)}
			{onPlanToWorktreeChange && (
				<AutoAdvanceToggle
					id="aa-plan-to-worktree"
					label={planAutoAdvanceLabel}
					title={planAutoAdvanceTitle}
					checked={planToWorktreeEnabled}
					onChange={onPlanToWorktreeChange}
					isDisabled={isDisabled}
				/>
			)}
			{onWorktreeToImplementationChange && (
				<AutoAdvanceToggle
					id="aa-worktree-to-implementation"
					label="Worktree → Implementation"
					title="Automatically launch implementation when worktree setup completes"
					checked={worktreeToImplementationEnabled}
					onChange={onWorktreeToImplementationChange}
					isDisabled={isDisabled}
				/>
			)}
			{onImplementationToPrChange && (
				<AutoAdvanceToggle
					id="aa-implementation-to-pr"
					label="Implementation → PR"
					title="Automatically generate PR description when implementation completes"
					checked={implementationToPrEnabled}
					onChange={onImplementationToPrChange}
					isDisabled={isDisabled}
				/>
			)}
		</div>
	)
}
