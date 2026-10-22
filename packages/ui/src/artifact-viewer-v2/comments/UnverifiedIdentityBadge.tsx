interface UnverifiedIdentityBadgeProps {
	onInspect?: () => void
}

export function UnverifiedIdentityBadge({ onInspect }: UnverifiedIdentityBadgeProps) {
	const className =
		'inline-flex items-center border border-[var(--terminal-warning)]/50 bg-[var(--terminal-warning)]/10 px-1.5 py-0.5 text-[9px] text-[var(--terminal-warning)]'

	return onInspect ? (
		<button
			type="button"
			className={`${className} hover:bg-[var(--terminal-warning)]/15`}
			title="This identity has not been verified"
			onClick={onInspect}
		>
			Unverified
		</button>
	) : (
		<span className={className} title="This identity has not been verified">
			Unverified
		</span>
	)
}
