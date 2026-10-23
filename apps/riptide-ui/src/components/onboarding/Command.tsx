import { Button } from '@humanlayer/ui/components/button'
import { Copy, Play, Terminal } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'

const TerminalPanel = lazy(() =>
	import('@/components/Terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel })),
)

export function Command({ children }: { children: string }) {
	const [terminalOpen, setTerminalOpen] = useState(false)
	const storageKey = `onboarding-repair-${children.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}`

	return (
		<div className="space-y-2">
			<p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
				<Terminal className="size-3.5" /> Run this command to fix it
			</p>
			<div className="flex items-center gap-2 bg-muted/60 px-3 py-2 font-mono text-xs">
				<code className="min-w-0 flex-1 overflow-x-auto">{children}</code>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() =>
						void navigator.clipboard.writeText(children).then(() => toast.success('Command copied'))
					}
				>
					<Copy className="size-3.5" /> Copy
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={() => setTerminalOpen(true)}>
					<Play className="size-3.5" /> Run
				</Button>
			</div>
			{terminalOpen ? (
				<Suspense fallback={<p className="p-3 text-xs text-muted-foreground">Opening terminal...</p>}>
					<TerminalPanel
						storageKey={storageKey}
						workingDirectory="~"
						initialInput={`${children}\n`}
						embedded
						fillHeight={false}
						isOpen
						onOpen={() => setTerminalOpen(true)}
						onClose={() => setTerminalOpen(false)}
					/>
				</Suspense>
			) : null}
		</div>
	)
}
