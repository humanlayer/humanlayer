import { LauncherProgress, type LauncherV3Operations } from './LauncherProgress'

export interface LauncherProgressWiredProps {
	operations: LauncherV3Operations
}

/** Narrow adapter from the injected launch-operation seam to the pure view. */
export function LauncherProgressWired({ operations }: LauncherProgressWiredProps) {
	return (
		<LauncherProgress
			operations={operations.steps}
			recovery={operations.recovery}
			onRetry={operations.onRetry}
			onSkip={operations.onSkip}
			onReset={operations.onReset}
		/>
	)
}
