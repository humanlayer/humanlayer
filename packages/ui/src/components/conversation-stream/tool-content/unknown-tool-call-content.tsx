import type { FC } from 'react'
import { formatToolNameForDisplay, truncateText } from '../utils/formatters'

export interface UnknownToolCallContentProps {
	toolName?: string
	toolInput?: Record<string, unknown>
	isCompleted?: boolean
	toolResultContent?: string
	isFocused?: boolean
	isGroupItem?: boolean
}

export const UnknownToolCallContent: FC<UnknownToolCallContentProps> = ({
	toolName,
	toolInput,
	isCompleted,
	toolResultContent,
	isFocused,
	isGroupItem = false,
}) => {
	const formatToolInput = () => {
		if (!toolInput) return 'No input'
		try {
			const entries = Object.entries(toolInput).slice(0, 2)
			return entries
				.map(([key, value]) => {
					const displayValue =
						typeof value === 'string' && value.length > 50
							? truncateText(value, 50)
							: JSON.stringify(value)
					return `${key}: ${displayValue}`
				})
				.join(', ')
		} catch {
			return 'Complex input'
		}
	}

	return (
		<div className="overflow-hidden text-sm">
			<div className="flex flex-col gap-1">
				<div className="flex items-baseline gap-2">
					<span className="text-sm font-semibold text-muted-foreground">{formatToolNameForDisplay(toolName)}</span>
					<span className="text-muted-foreground/60 text-sm">{formatToolInput()}</span>
				</div>

				{isCompleted && toolResultContent && !isGroupItem && (
					<div className="text-sm text-muted-foreground/60 truncate">
						{truncateText(toolResultContent, 100)}
					</div>
				)}

				{isFocused && !isGroupItem && (
					<span className="text-sm text-muted-foreground italic">
						<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
					</span>
				)}
			</div>
		</div>
	)
}
