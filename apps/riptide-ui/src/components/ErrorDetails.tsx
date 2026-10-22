import { Button } from '@humanlayer/ui/components/button'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { Check, Copy } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

interface ErrorDetailsProps {
	error: unknown
	componentStack?: string | null
}

/**
 * Formats error information into a structured string for copying.
 */
const ErrorDisplay = Schema.instanceOf(Error)

const parseErrorDisplay = (error: unknown) => {
	const nativeError = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorDisplay)(error))
	if (nativeError) return { name: nativeError.name, message: nativeError.message, stack: nativeError.stack }

	const message = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(error))
	return message
		? { name: 'Error', message, stack: undefined }
		: { name: 'Error', message: 'Unknown error', stack: undefined }
}

function formatErrorForCopy(error: ReturnType<typeof parseErrorDisplay>, componentStack?: string | null): string {
	const lines: string[] = []

	lines.push(`Error: ${error.name}`)
	lines.push(`Message: ${error.message}`)
	if (error.stack) {
		lines.push('')
		lines.push('Stack Trace:')
		lines.push(error.stack)
	}

	if (componentStack) {
		lines.push('')
		lines.push('Component Stack:')
		lines.push(componentStack)
	}

	return lines.join('\n')
}

/**
 * Expandable error details component with copy functionality.
 * Shows error name, message, stack trace, and component stack in separate sections.
 */
export function ErrorDetails({ error, componentStack }: ErrorDetailsProps) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [copied, setCopied] = useState(false)
	const errorDisplay = parseErrorDisplay(error)

	const handleCopy = useCallback(() => {
		const content = formatErrorForCopy(errorDisplay, componentStack)
		void copyToClipboard(content)
		setCopied(true)
		toast.success('Copied error details to clipboard')
		setTimeout(() => setCopied(false), 2000)
	}, [errorDisplay, componentStack, copyToClipboard])

	if (!error) {
		return null
	}

	return (
		<details className="mt-6 text-left w-full max-w-2xl">
			<summary className="cursor-pointer font-mono text-sm text-muted-foreground hover:text-foreground transition-colors">
				Show Error Details
			</summary>
			<div className="mt-4 relative">
				<Button
					variant="ghost"
					size="sm"
					className="absolute top-2 right-2 h-7 gap-1.5 text-xs"
					onClick={handleCopy}
				>
					{copied ? (
						<>
							<Check className="h-3 w-3 text-success" />
							Copied
						</>
					) : (
						<>
							<Copy className="h-3 w-3" />
							Copy Error Details
						</>
					)}
				</Button>
				<div className="bg-muted p-4 rounded overflow-auto text-xs font-mono space-y-4 pt-10">
					<div>
						<div className="text-muted-foreground mb-1">Error</div>
						<div className="text-destructive">{errorDisplay.name}</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Message</div>
						<div>{errorDisplay.message}</div>
					</div>
					{errorDisplay.stack && (
						<div>
							<div className="text-muted-foreground mb-1">Stack Trace</div>
							<pre className="whitespace-pre-wrap break-all">{errorDisplay.stack}</pre>
						</div>
					)}
					{componentStack && (
						<div>
							<div className="text-muted-foreground mb-1">Component Stack</div>
							<pre className="whitespace-pre-wrap break-all">{componentStack}</pre>
						</div>
					)}
				</div>
			</div>
		</details>
	)
}
