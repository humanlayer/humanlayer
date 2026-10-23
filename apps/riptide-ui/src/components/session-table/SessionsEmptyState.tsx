import { Button } from '@humanlayer/ui/components/button'
import type { FC } from 'react'

export interface SessionsEmptyStateProps {
	onCreateSession?: () => void
	onOpenCommandPalette?: () => void
}

export const SessionsEmptyState: FC<SessionsEmptyStateProps> = ({ onCreateSession, onOpenCommandPalette }) => {
	return (
		<div className="flex justify-center py-20 px-8">
			<div className="flex flex-col items-start w-full max-w-xl">
				<h1 className="text-2xl font-semibold mb-8">Welcome</h1>

				<div className="text-sm text-muted-foreground mb-8 space-y-4">
					<p>Use Claude Code or Codex to solve hard problems in complex codebases.</p>
					<p>Authenticate Codex with the HumanLayer CLI before starting your first Codex session.</p>
					<p>Create a session to get started.</p>
				</div>

				<div className="flex gap-2">
					<Button onClick={onCreateSession} size="lg">
						Create Session <kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded">C</kbd>
					</Button>
					<Button variant="secondary" size="lg" onClick={onOpenCommandPalette}>
						Open command palette{' '}
						<kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded">⌘+K</kbd>
					</Button>
				</div>
			</div>
		</div>
	)
}
