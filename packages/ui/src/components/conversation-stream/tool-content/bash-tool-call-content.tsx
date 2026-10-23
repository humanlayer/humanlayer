import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Check, Copy } from 'lucide-react'
import { type FC, useCallback, useState } from 'react'
import { StatusBadge } from '../status-badge'
import type { BashToolInput, ToolCallContentProps } from '../types'
import { formatToolResult, getApprovalStatusColor, parseExitCode } from '../utils/formatters'
import { AnsiText, hasAnsiCodes } from '../../../lib/ansi-parser'

export const BashToolCallContent: FC<ToolCallContentProps<BashToolInput>> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const formattedResult = toolResultContent ? formatToolResult(toolResultContent, 2) : null
	const isDenied = approvalStatus === 'denied'
	const exitCode = parseExitCode(toolResultContent)
	const hasNonZeroExit = exitCode !== null && exitCode !== 0
	const isError = isDenied || hasNonZeroExit
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(toolInput.command)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy command:', error)
		}
	}, [toolInput.command])

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Bash</span>
						{toolInput.description && (
							<span className="text-sm text-muted-foreground">{toolInput.description}</span>
						)}
					</div>
					<div className="mt-1 relative group">
						<pre className="text-xs font-mono bg-[var(--terminal-bg-alt)] text-[var(--terminal-accent)] border border-[var(--terminal-border)] tracking-tight shadow-sm px-2 py-1 pr-6 rounded-md max-h-32 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all">
							{toolInput.command}
						</pre>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className={`absolute top-0.5 right-0.5 w-5 h-5 min-h-0 ${isFocused ? '' : 'opacity-0 group-hover:opacity-100'}`}
									onClick={(e) => {
										e.stopPropagation()
										handleCopy()
									}}
								>
									{copied ? (
										<Check className="w-2.5 h-2.5 text-success" />
									) : (
										<Copy className="w-2.5 h-2.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent className="flex items-center gap-1.5">
								<span>Copy command</span>
								<KeyboardShortcut size="xs">Y</KeyboardShortcut>
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{toolInput.run_in_background && (
				<div className="text-sm text-muted-foreground">Running in background</div>
			)}

			{toolInput.timeout && (
				<div className="text-sm text-muted-foreground">Timeout: {toolInput.timeout}ms</div>
			)}

			{formattedResult && (
				<div
					className={`mt-1 text-sm ${isError ? 'text-[var(--terminal-error)]' : 'text-muted-foreground'} font-mono flex items-start gap-1`}
				>
					<span className={isError ? 'text-[var(--terminal-error)]/50' : 'text-muted-foreground/50'}>⎿</span>
					<span className="whitespace-pre-line">
						{toolResultContent && hasAnsiCodes(toolResultContent) ? (
							<AnsiText content={formattedResult} />
						) : (
							formattedResult
						)}
						<span className={`text-sm text-muted-foreground/50 ml-2 ${isFocused ? '' : 'invisible'}`}>
							<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
						</span>
					</span>
				</div>
			)}
		</div>
	)
}
