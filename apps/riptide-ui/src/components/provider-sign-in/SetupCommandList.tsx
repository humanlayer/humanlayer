import { Button } from '@humanlayer/ui/components/button'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'

export function SetupCommandList({ commands }: { commands: readonly string[] }) {
	const [, copyToClipboard] = useCopyToClipboard()
	return (
		<div className="space-y-2">
			{commands.map((command) => (
				<div
					key={command}
					className="group relative flex items-center gap-2 border border-border bg-muted/50 p-3 font-mono text-xs"
				>
					<span className="select-none text-muted-foreground">$</span>
					<code className="break-all text-foreground">{command}</code>
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Copy ${command}`}
						className="absolute right-2 top-2 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
						onClick={() => {
							void copyToClipboard(command)
							toast.success('Copied to clipboard')
						}}
					>
						<Copy className="h-3.5 w-3.5" />
					</Button>
				</div>
			))}
		</div>
	)
}
