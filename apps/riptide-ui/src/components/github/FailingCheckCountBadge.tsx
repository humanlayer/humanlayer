import type { FC } from 'react'

/** The failing-check count next to a label. Absent at zero, so a clean run shows nothing. */
export const FailingCheckCountBadge: FC<{ count: number }> = ({ count }) =>
	count > 0 ? (
		<span className="shrink-0 font-mono text-[10px] text-[var(--terminal-error)]" aria-label={`${count} failing`}>
			{count}
		</span>
	) : null
