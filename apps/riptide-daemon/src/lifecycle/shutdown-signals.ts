export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number]

type ShutdownSignalHandler = (signal: ShutdownSignal) => void

export const installShutdownSignals = (initialHandler: ShutdownSignalHandler) => {
	let handler = initialHandler
	const listeners = SHUTDOWN_SIGNALS.map((signal) => [signal, () => handler(signal)] as const)
	for (const [signal, listener] of listeners) process.on(signal, listener)
	return {
		route(nextHandler: ShutdownSignalHandler): void {
			handler = nextHandler
		},
		remove(): void {
			for (const [signal, listener] of listeners) process.off(signal, listener)
		},
	}
}
