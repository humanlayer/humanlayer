import logger from '@/logger'

import type { ShutdownDeadline } from './shutdown-deadline'

type StartupShutdownOptions = {
	readonly deadline: ShutdownDeadline
	readonly stopHeartbeat: () => void
	readonly disposeRuntime: () => Promise<void>
	readonly exit: () => void
}

export const createStartupShutdown = (options: StartupShutdownOptions) => {
	let started = false
	return {
		shutdown(signal: string): void {
			if (!options.deadline.begin(signal)) return
			started = true
			logger.info({ signal }, 'Received shutdown signal before daemon startup finished')
			options.stopHeartbeat()
			void options
				.disposeRuntime()
				.catch((error) => {
					logger.error(error, 'Error while disposing the daemon runtime during startup')
				})
				.finally(() => {
					options.deadline.complete()
					options.exit()
				})
		},
		isStarted(): boolean {
			return started
		},
		untilExit(): Promise<never> {
			return new Promise<never>(() => {})
		},
	}
}
