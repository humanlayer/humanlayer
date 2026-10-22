/**
 * shared.tsx
 *
 * Shared types and components used across NewTaskFormV2 section components.
 */

import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'

// --- Axis types ---

export type IssueSource = 'inline' | 'linear' | 'jira' | 'github'
export type Workflow = 'rpi' | 'outline_only' | 'prd_tdd' | 'oneshot' | 'freeform'
export type WorkspaceTiming = 'now' | 'later' | 'never'

export function normalizeSelectableWorkflow(workflow: Workflow): Workflow {
	return workflow === 'rpi' ? 'outline_only' : workflow
}

// --- AxisSelector component ---

export function AxisSelector<T extends string>({
	label,
	options,
	selected,
	onSelect,
	disabled,
	layout = 'flex',
}: {
	label: string
	options: { value: T; label: string; description?: string; disabledReason?: string; badge?: string }[]
	selected: T
	onSelect: (value: T) => void
	disabled?: boolean
	/** Layout mode: 'flex' for horizontal row, 'grid-2-2' for two rows of two, 'grid-3-2' for legacy 5-option layout */
	layout?: 'flex' | 'grid-2-2' | 'grid-3-2'
}) {
	const selectedOption = options.find((o) => o.value === selected)

	const renderButton = (option: (typeof options)[number], wrapperClassName = 'flex-1 basis-0 min-w-0') => {
		const showDescriptionInButton = layout !== 'flex' && option.description
		const button = (
			<Button
				type="button"
				variant="outline"
				onClick={() => !option.disabledReason && onSelect(option.value)}
				className={`w-full group relative overflow-hidden ${showDescriptionInButton ? 'h-24 flex-col items-start justify-start gap-1 whitespace-normal py-3 text-left' : ''} ${selected === option.value ? 'bg-accent text-accent-foreground' : ''} ${option.disabledReason ? 'opacity-50 cursor-not-allowed' : ''}`}
				disabled={disabled || !!option.disabledReason}
			>
				{option.badge && (
					<Badge
						variant="outline"
						className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0"
						style={{
							borderColor: 'color-mix(in srgb, var(--terminal-color-13) 50%, transparent)',
							backgroundColor: 'color-mix(in srgb, var(--terminal-color-13) 10%, transparent)',
							color: 'var(--terminal-color-13)',
						}}
					>
						{option.badge}
					</Badge>
				)}
				<span>{option.label}</span>
				{showDescriptionInButton && (
					<span
						className={`text-xs font-normal normal-case tracking-normal leading-snug line-clamp-3 group-hover:text-background ${selected === option.value ? 'text-accent-foreground/95' : 'text-foreground/80'}`}
					>
						{option.description}
					</span>
				)}
			</Button>
		)

		if (option.disabledReason) {
			return (
				<Tooltip key={option.value}>
					<TooltipTrigger asChild className={wrapperClassName}>
						<span>{button}</span>
					</TooltipTrigger>
					<TooltipContent>{option.disabledReason}</TooltipContent>
				</Tooltip>
			)
		}

		return (
			<div key={option.value} className={wrapperClassName}>
				{button}
			</div>
		)
	}

	const optionsNode =
		layout === 'grid-2-2' ? (
			<div className="grid grid-cols-2 gap-2">{options.map((option) => renderButton(option, 'min-w-0'))}</div>
		) : layout === 'grid-3-2' ? (
			// Grid layout: 3 columns on top row, 2 columns on bottom row
			<div className="space-y-2">
				<div className="grid grid-cols-3 gap-2">
					{options.slice(0, 3).map((option) => renderButton(option, 'min-w-0'))}
				</div>
				{options.slice(3).length > 0 && (
					<div className="grid grid-cols-2 gap-2">
						{options.slice(3).map((option) => renderButton(option, 'min-w-0'))}
					</div>
				)}
			</div>
		) : (
			// Default flex layout
			<div className="flex gap-3">{options.map((option) => renderButton(option))}</div>
		)

	return (
		<div className="space-y-2">
			<p className="text-sm font-medium">{label}</p>
			{optionsNode}
			{selectedOption?.disabledReason && (
				<p className="text-sm text-muted-foreground">{selectedOption.disabledReason}</p>
			)}
			{layout === 'flex' && !selectedOption?.disabledReason && selectedOption?.description && (
				<p className="text-sm text-muted-foreground">{selectedOption.description}</p>
			)}
		</div>
	)
}

// --- Workflow options constant ---

export const WORKFLOW_OPTIONS: { value: Workflow; label: string; description: string; badge?: string }[] = [
	{
		value: 'outline_only',
		label: 'RPI',
		description: 'Structured workflow with Research / Plan / Implement phases',
	},
	{
		value: 'prd_tdd',
		label: 'PRD-Oriented',
		description: 'Workflow with Product Requirements and Deep Technical Design phases',
		badge: 'alpha',
	},
	{
		value: 'oneshot',
		label: 'Oneshot',
		description: 'Implement the ticket or task directly',
	},
	{
		value: 'freeform',
		label: 'Freeform',
		description: 'A named group of ad-hoc agent sessions',
	},
]
