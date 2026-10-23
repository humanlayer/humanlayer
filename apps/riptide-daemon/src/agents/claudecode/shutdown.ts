import logger from '@/logger'

/**
 * Interface for shutdown coordination.
 * Enables dependency injection in tests.
 */
export interface IShutdownCoordinator {
	registerSessionCompletion(sessionId: string): void
	resolveSessionCompletion(sessionId: string): void
	registerLifecycleParticipant(name: string, participant: ShutdownLifecycleParticipant): () => void
	isDaemonShuttingDown(): boolean
	getShutdownSignal(): AbortSignal
	shutdownAllSessions(): Promise<void>
}

export interface ShutdownLifecycleParticipant {
	readonly shutdown: () => Promise<void>
}

export interface ShutdownCoordinatorOptions {
	timeoutMs?: number
}

/**
 * Class-based shutdown coordinator with instance state.
 * Enables isolated test instances with no shared state between tests.
 */
export class ShutdownCoordinator implements IShutdownCoordinator {
	private controller = new AbortController()
	private completionPromises = new Map<string, Promise<void>>()
	private completionResolvers = new Map<string, () => void>()
	private lifecycleParticipants = new Map<string, ShutdownLifecycleParticipant>()
	private readonly timeoutMs: number
	private shutdownPromise: Promise<void> | undefined

	constructor(options: ShutdownCoordinatorOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? 10_000
	}

	/**
	 * Register a session's completion promise for shutdown coordination.
	 * Called when a session starts running.
	 */
	registerSessionCompletion(sessionId: string): void {
		let resolve: () => void = () => {}
		const promise = new Promise<void>((r) => {
			resolve = r
		})
		this.completionPromises.set(sessionId, promise)
		this.completionResolvers.set(sessionId, resolve)
	}

	/**
	 * Mark a session's completion promise as resolved and remove it.
	 * MUST be called before removing from tracking (resolves first to avoid race condition).
	 * Safe to call multiple times - resolving an already-resolved promise is a no-op.
	 */
	resolveSessionCompletion(sessionId: string): void {
		const resolve = this.completionResolvers.get(sessionId)
		if (resolve) {
			resolve()
		}
		this.completionResolvers.delete(sessionId)
		this.completionPromises.delete(sessionId)
	}

	/** Register a process-scoped resource that must stop before daemon teardown continues. */
	registerLifecycleParticipant(name: string, participant: ShutdownLifecycleParticipant): () => void {
		if (this.isDaemonShuttingDown()) {
			throw new Error(`Cannot register lifecycle participant ${name} after shutdown has started`)
		}

		this.lifecycleParticipants.set(name, participant)
		return () => {
			if (this.lifecycleParticipants.get(name) === participant) {
				this.lifecycleParticipants.delete(name)
			}
		}
	}

	/**
	 * Check if daemon is shutting down (signal has been aborted)
	 */
	isDaemonShuttingDown(): boolean {
		return this.controller.signal.aborted
	}

	/**
	 * Get the shutdown signal for session runners to listen to
	 */
	getShutdownSignal(): AbortSignal {
		return this.controller.signal
	}

	/**
	 * Gracefully shut down all running sessions.
	 * Called when daemon receives SIGTERM/SIGINT.
	 *
	 * 1. Aborts the shutdown signal (notifies all listening sessions)
	 * 2. Waits for all sessions to complete cleanup (with 10s timeout)
	 */
	shutdownAllSessions(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise

		this.shutdownPromise = this.performShutdown()
		return this.shutdownPromise
	}

	private async performShutdown(): Promise<void> {
		const sessionCount = this.completionPromises.size
		const participants = [...this.lifecycleParticipants.entries()]

		// Signal all sessions to interrupt - they're listening via addEventListener
		// Always abort the controller, even if no sessions, to mark daemon as shutting down
		this.controller.abort()

		if (sessionCount === 0 && participants.length === 0) {
			logger.info('No running sessions to interrupt on shutdown')
			return
		}

		logger.info(
			{ sessionCount, lifecycleParticipantCount: participants.length },
			'Shutting down running sessions and lifecycle participants',
		)

		const participantShutdowns = participants.map(async ([name, participant]) => {
			try {
				await participant.shutdown()
			} catch (error) {
				logger.error({ error, participant: name }, 'Lifecycle participant shutdown failed')
			}
		})

		// Promise-mode session callbacks retain the existing bounded wait. Process-scoped
		// lifecycle participants own their internal bounds and must finish before teardown
		// continues, otherwise sync/Sentry could be disposed underneath their finalizers.
		await Promise.race([
			Promise.allSettled(this.completionPromises.values()),
			new Promise((resolve) => setTimeout(resolve, this.timeoutMs)),
		])
		await Promise.allSettled(participantShutdowns)

		logger.info('All session cleanup complete (or timed out)')
	}
}

// Default singleton instance for production use
export const defaultShutdownCoordinator = new ShutdownCoordinator()

// Backwards-compatible exports wrapping the default instance
// These allow existing code to work without changes during migration

/** @deprecated Use defaultShutdownCoordinator.controller.signal instead */
export const shutdownController = {
	get signal() {
		return defaultShutdownCoordinator.getShutdownSignal()
	},
	abort() {
		// Trigger shutdown via the class method
		void defaultShutdownCoordinator.shutdownAllSessions()
	},
}

export function registerSessionCompletion(sessionId: string): void {
	defaultShutdownCoordinator.registerSessionCompletion(sessionId)
}

export function resolveSessionCompletion(sessionId: string): void {
	defaultShutdownCoordinator.resolveSessionCompletion(sessionId)
}

export function isDaemonShuttingDown(): boolean {
	return defaultShutdownCoordinator.isDaemonShuttingDown()
}

export function getShutdownSignal(): AbortSignal {
	return defaultShutdownCoordinator.getShutdownSignal()
}

export async function shutdownAllSessions(): Promise<void> {
	return defaultShutdownCoordinator.shutdownAllSessions()
}
