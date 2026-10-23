export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000

export type ForcedShutdownReason = 'deadline_exceeded' | 'repeated_request'

type ShutdownDeadlineOptions = {
	readonly forceShutdown: (reason: ForcedShutdownReason, signal: string) => void
	readonly timeoutMs?: number
}

/** Enforces the process-level escape hatches around best-effort graceful shutdown. */
export const createShutdownDeadline = (options: ShutdownDeadlineOptions) => {
	let initialSignal: string | undefined
	let timeout: ReturnType<typeof setTimeout> | undefined
	let forced = false

	const force = (reason: ForcedShutdownReason, signal: string) => {
		if (forced) return
		forced = true
		if (timeout !== undefined) clearTimeout(timeout)
		options.forceShutdown(reason, signal)
	}

	return {
		begin(signal: string): boolean {
			if (initialSignal !== undefined) {
				force('repeated_request', signal)
				return false
			}

			initialSignal = signal
			timeout = setTimeout(
				() => force('deadline_exceeded', initialSignal ?? signal),
				options.timeoutMs ?? GRACEFUL_SHUTDOWN_TIMEOUT_MS,
			)
			return true
		},
		complete(): void {
			if (timeout !== undefined) clearTimeout(timeout)
			timeout = undefined
		},
		isStarted(): boolean {
			return initialSignal !== undefined
		},
	}
}

export type ShutdownDeadline = ReturnType<typeof createShutdownDeadline>
