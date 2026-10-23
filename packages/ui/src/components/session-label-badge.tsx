import { cn } from '@humanlayer/ui/lib/utils'
import { Badge } from './badge'

export type SessionLabel = { name: string; title: string }

// Map label names to terminal color variables
export function getLabelColor(name: string | undefined | null): string {
	if (typeof name !== 'string') {
		return 'var(--terminal-fg)'
	}
	// Todo phase - muted foreground (backlog)
	if (name.startsWith('rpi:todo')) {
		return 'var(--terminal-fg-dim)'
	}
	// Research questions - blue (scoping)
	if (name.startsWith('rpi:research-questions')) {
		return 'var(--terminal-label-blue, var(--terminal-accent))'
	}
	// Research phase - green (validated findings)
	if (name.startsWith('rpi:research')) {
		return 'var(--terminal-label-green, var(--terminal-success))'
	}
	// Design PRD phase - lightened purple (product requirements)
	if (name.startsWith('rpi:design-prd')) {
		return 'color-mix(in srgb, var(--terminal-label-purple, var(--terminal-accent-alt)) 85%, var(--terminal-fg))'
	}
	// Design TDD phase - lighter purple (technical design)
	if (name.startsWith('rpi:design-tdd')) {
		return 'color-mix(in srgb, var(--terminal-label-purple, var(--terminal-accent-alt)) 70%, var(--terminal-fg))'
	}
	// Design phase - purple (creative decisions)
	if (name.startsWith('rpi:design')) {
		return 'var(--terminal-label-purple, var(--terminal-accent-alt))'
	}
	// Structure phase - pink (organizing)
	if (name.startsWith('rpi:structure')) {
		return 'var(--terminal-label-pink, var(--terminal-warning))'
	}
	// Plan phase - a pink/purple bridge into implementation
	if (name.startsWith('rpi:plan')) {
		return 'color-mix(in srgb, var(--terminal-label-pink, var(--terminal-color-13)) 65%, var(--terminal-label-purple, var(--terminal-color-13)))'
	}
	// Worktree setup - muted gray (infrastructure)
	if (name.startsWith('rpi:worktree-setup')) {
		return 'var(--terminal-fg-dim)'
	}
	// Implementation phase - green (building)
	if (name.startsWith('rpi:implementation')) {
		return 'var(--terminal-label-green, var(--terminal-success))'
	}
	// Describe PR phase - bright blue (finalization)
	if (name.startsWith('rpi:describe-pr')) {
		return 'var(--terminal-label-blue, var(--terminal-color-12))'
	}
	// Fallback for unknown labels
	return 'var(--terminal-fg)'
}

export interface SessionLabelBadgeProps {
	label: SessionLabel
	className?: string
}

export function SessionLabelBadge({ label, className }: SessionLabelBadgeProps) {
	// Defensive: handle malformed label data
	if (!label || typeof label !== 'object') {
		console.warn('[SessionLabelBadge] Invalid label:', label)
		return null
	}

	const color = getLabelColor(label.name)
	const title = typeof label.title === 'string' ? label.title : String(label.name ?? 'unknown')

	return (
		<Badge
			variant="outline"
			className={cn('text-xs', className)}
			style={{
				borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
				backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
				color: color,
			}}
		>
			{title}
		</Badge>
	)
}

// Re-export RPI_LABELS from constants for backwards compatibility
export { RPI_LABELS } from '../constants/rpi-skills'
