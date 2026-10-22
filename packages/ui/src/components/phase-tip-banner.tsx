import { cn } from '@humanlayer/ui/lib/utils'
import type { ComponentType, ReactNode } from 'react'
import { Button } from './button'
import { MarkdownRenderer } from './markdown-renderer'
import { SessionLabelBadge } from './session-label-badge'

function ResearchQuestionsTip() {
	return (
		<p>
			The agent is preparing research questions. You can review them if you&apos;d like, but the session
			will automatically proceed to research when they&apos;re ready.
		</p>
	)
}

function ResearchTip() {
	return (
		<MarkdownRenderer
			content={`This phase produces an objective analysis of how the codebase works today. Compressing truth — no implementation intentions leaking in.

When the artifact is created, look for:

- Accuracy and completeness against actual code
- **Resolve open questions before moving on** — ask the agent to investigate, answer yourself, or remove
- **Ask the agent** to dig deeper into specific areas or remove irrelevant findings`}
		/>
	)
}

function DesignTip() {
	return (
		<MarkdownRenderer
			content={`**Most important phase.** Research meets ticket for the first time. The agent presents design questions with options and recommendations. Everything that matters goes in this doc — come back here if you ever need to rewind.

When the artifact is created, look for:

- Trade-offs covered, recommendations grounded in research, correct patterns surfaced
- Answer questions, provide preferences not listed, surface different patterns
- This doc drives the build — every detail and preference you have should be tracked
- **Ask the agent** to add detail for anything that you don't want to yolo or vibe code`}
		/>
	)
}

function StructureTip() {
	return (
		<MarkdownRenderer
			content={`This phase produces a phased plan describing the order of changes. Design was about where we're going — structure is about how we get there.

When the artifact is created, look for:

- **Vertical slices over horizontal layers** — wire multiple systems together per phase, testable independently
- Each phase independently verifiable, validation steps match how you would test this feature along the way
- No conditional forks — every decision should already be made
- **Ask the agent** to reorder phases or add code snippets`}
		/>
	)
}

function PlanTip() {
	return (
		<MarkdownRenderer
			content={`This phase produces a detailed implementation plan with specific file changes and code snippets. This is more for the implementing agent — spot check it, real code review happens during implementation.

When the artifact is created, look for:

- Validation commands are correct — wrong test commands waste agent context
- Correct file paths, no obvious code smells
- **Ask the agent** to add detail, fix commands, or adjust testing approach`}
		/>
	)
}

function WorktreeSetupTip() {
	return (
		<MarkdownRenderer
			content={`Research and planning happens on main for up-to-date code. This phase creates a git worktree to isolate your changes.

When setup completes, check:

- Correct branch name and working directory path
- **Ask the agent** for a different branch name or additional setup`}
		/>
	)
}

function ImplementationTip() {
	return (
		<MarkdownRenderer
			content={`The agent executes the plan phase by phase using a subagent, keeping parent context low for re-steering.

Between phases:

- Review the diff, run locally, check tests — say **"commit and proceed"** when happy
- To make changes between phases or at the end: iterate here, or use \`/rpi:iterate-implementation\` in a new session
- When done: use \`/rpi:describe-pr\` to create a PR with a detailed description`}
		/>
	)
}

function DescribePrTip() {
	return (
		<MarkdownRenderer
			content={`This phase produces a PR description summarizing changes, linking to the ticket, and providing a test plan. Deviations from the plan are captured here.

When the description is ready, check:

- Accurate summary, documented deviations, linked ticket, complete test plan
- **Ask the agent** to adjust the description, modify the test plan, or add caveats`}
		/>
	)
}

const PHASE_TIPS: Record<string, ComponentType> = {
	'research-questions': ResearchQuestionsTip,
	research: ResearchTip,
	design: DesignTip,
	structure: StructureTip,
	plan: PlanTip,
	'worktree-setup': WorktreeSetupTip,
	implementation: ImplementationTip,
	'describe-pr': DescribePrTip,
}

/** True when the phase has written tip content — use this to decide whether to
 * surface a Tips affordance at all, so we never show an empty tab or modal. */
export function hasPhaseTip(phase: string | null | undefined): boolean {
	return !!phase && Object.hasOwn(PHASE_TIPS, phase)
}

export interface PhaseTipRootProps {
	phase: string
	children: ReactNode
}

export function PhaseTipRoot({ phase, children }: PhaseTipRootProps) {
	if (!hasPhaseTip(phase)) return null
	return <>{children}</>
}

export interface PhaseTipContentProps {
	phase: string
}

export function PhaseTipContent({ phase }: PhaseTipContentProps) {
	const Tip = PHASE_TIPS[phase]
	if (!Tip) return null
	return <Tip />
}

export interface PhaseTipBannerProps {
	phase: string
	onDontShowAgain?: () => void
	className?: string
}

export function PhaseTipBanner({ phase, onDontShowAgain, className }: PhaseTipBannerProps) {
	return (
		<PhaseTipRoot phase={phase}>
			<div className={cn('flex flex-col gap-2 p-2 h-full min-h-0 text-xs', className)}>
				<div className="shrink-0 mb-1">
					<SessionLabelBadge label={{ name: `rpi:${phase}`, title: phase }} className="w-auto" />
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto">
					<PhaseTipContent phase={phase} />
				</div>
				{onDontShowAgain && (
					<div className="shrink-0">
						<Button
							variant="secondary"
							size="sm"
							className="self-start"
							onClick={onDontShowAgain}
						>
							Don't show again
						</Button>
					</div>
				)}
			</div>
		</PhaseTipRoot>
	)
}
