import { DEGRADE_ERROR_THRESHOLD, RECOVERY_SUCCESS_THRESHOLD } from './constants.ts'

/** Minimal logger interface — avoids coupling to @humanlayer/logger transports. */
interface TrackerLogger {
	info(...args: unknown[]): void
	debug(...args: unknown[]): void
}

const noopLogger: TrackerLogger = { info() {}, debug() {} }

type SyncMode = 'electric' | 'query'
type ForceMode = SyncMode | 'auto'

interface CollectionState {
	mode: SyncMode
	consecutiveSuccesses: number
	consecutiveErrors: number
	forcedMode: ForceMode
	electricOffline: boolean
	queryOffline: boolean
}

type ModeChangeListener = (name: string, mode: SyncMode) => void
type OfflineChangeListener = (name: string, offline: boolean) => void

/**
 * Per-collection state machine that tracks Electric SQL health and drives
 * automatic failover to query-driven sync when Electric is failing.
 *
 * Rules:
 * - Swap to query after `errorThreshold` consecutive Electric errors (default DEGRADE_ERROR_THRESHOLD).
 *   A threshold above 1 avoids flapping to query on a single transient long-poll connection drop.
 * - Recover back to Electric after RECOVERY_SUCCESS_THRESHOLD consecutive Electric 2XX responses
 * - Any Electric success resets the consecutive-error counter; any error resets recovery progress
 * - Force mode overrides automatic transitions until reset to 'auto'
 * - A collection is "offline" when both Electric and query paths are failing
 */
export class CollectionHealthTracker {
	private readonly recoveryThreshold: number
	private readonly errorThreshold: number
	private readonly states: Map<string, CollectionState>
	private readonly modeListeners: Set<ModeChangeListener>
	private readonly offlineListeners: Set<OfflineChangeListener>
	private readonly logger: TrackerLogger
	private cachedModes: Record<string, SyncMode> | null = null
	private cachedOffline: string[] = []

	constructor(opts: {
		collections: string[]
		recoveryThreshold?: number
		errorThreshold?: number
		logger?: TrackerLogger
	}) {
		this.recoveryThreshold = opts.recoveryThreshold ?? RECOVERY_SUCCESS_THRESHOLD
		this.errorThreshold = opts.errorThreshold ?? DEGRADE_ERROR_THRESHOLD
		this.logger = opts.logger ?? noopLogger
		this.states = new Map()
		this.modeListeners = new Set()
		this.offlineListeners = new Set()

		for (const name of opts.collections) {
			this.states.set(name, {
				mode: 'electric',
				consecutiveSuccesses: 0,
				consecutiveErrors: 0,
				forcedMode: 'auto',
				electricOffline: false,
				queryOffline: false,
			})
		}
	}

	private getState(name: string): CollectionState {
		const state = this.states.get(name)
		if (!state) {
			throw new Error(`Unknown collection: ${name}`)
		}
		return state
	}

	private emitModeChange(name: string, mode: SyncMode): void {
		this.cachedModes = null
		for (const listener of this.modeListeners) {
			listener(name, mode)
		}
	}

	private emitOfflineChange(name: string, offline: boolean): void {
		this.cachedOffline = this.computeOfflineCollections()
		for (const listener of this.offlineListeners) {
			listener(name, offline)
		}
	}

	private setMode(name: string, newMode: SyncMode): void {
		const state = this.getState(name)
		if (state.mode !== newMode) {
			this.logger.info({ collection: name, from: state.mode, to: newMode }, 'Sync mode transition')
			state.mode = newMode
			this.emitModeChange(name, newMode)
		}
	}

	/**
	 * Record an Electric error for the named collection.
	 * Fails over to query mode once `errorThreshold` consecutive errors accumulate
	 * (unless forced to electric). A single transient error is tolerated so we don't
	 * flap to query on a routine long-poll connection drop.
	 */
	recordElectricError(name: string): void {
		const state = this.getState(name)
		// Any error resets recovery progress and advances the error streak.
		state.consecutiveSuccesses = 0
		state.consecutiveErrors += 1

		// Tolerate transient errors below the threshold — stay in the current mode.
		if (state.consecutiveErrors < this.errorThreshold) {
			return
		}

		const wasOffline = this.isOffline(name)
		state.electricOffline = true

		if (state.forcedMode === 'auto') {
			this.setMode(name, 'query')
		}

		const isNowOffline = this.isOffline(name)
		if (wasOffline !== isNowOffline) {
			this.emitOfflineChange(name, isNowOffline)
		}
	}

	/**
	 * Record an Electric 2XX success for the named collection.
	 * Counts toward recovery threshold; switches back to electric after threshold reached.
	 */
	recordElectricSuccess(name: string): void {
		const state = this.getState(name)
		const wasOffline = this.isOffline(name)

		state.electricOffline = false
		// A success clears any accumulated error streak so transient errors don't add up
		// across long stretches of healthy syncing.
		state.consecutiveErrors = 0

		if (state.forcedMode === 'auto' && state.mode === 'query') {
			state.consecutiveSuccesses += 1
			this.logger.debug(
				{
					collection: name,
					consecutiveSuccesses: state.consecutiveSuccesses,
					threshold: this.recoveryThreshold,
				},
				'Electric recovery progress',
			)
			if (state.consecutiveSuccesses >= this.recoveryThreshold) {
				state.consecutiveSuccesses = 0
				this.setMode(name, 'electric')
			}
		} else {
			state.consecutiveSuccesses = 0
		}

		const isNowOffline = this.isOffline(name)
		if (wasOffline !== isNowOffline) {
			this.emitOfflineChange(name, isNowOffline)
		}
	}

	/**
	 * Record a query sync error for the named collection.
	 */
	recordQueryError(name: string): void {
		const state = this.getState(name)
		const wasOffline = this.isOffline(name)
		state.queryOffline = true
		const isNowOffline = this.isOffline(name)
		if (wasOffline !== isNowOffline) {
			this.emitOfflineChange(name, isNowOffline)
		}
	}

	/**
	 * Record a query sync success for the named collection.
	 */
	recordQuerySuccess(name: string): void {
		const state = this.getState(name)
		const wasOffline = this.isOffline(name)
		state.queryOffline = false
		const isNowOffline = this.isOffline(name)
		if (wasOffline !== isNowOffline) {
			this.emitOfflineChange(name, isNowOffline)
		}
	}

	/**
	 * Get the current sync mode for the named collection.
	 */
	getMode(name: string): SyncMode {
		const state = this.getState(name)
		if (state.forcedMode !== 'auto') {
			return state.forcedMode
		}
		return state.mode
	}

	/**
	 * Get the current sync mode for all tracked collections.
	 */
	getAllModes(): Record<string, SyncMode> {
		if (this.cachedModes) return this.cachedModes
		const result: Record<string, SyncMode> = {}
		for (const [name] of this.states) {
			result[name] = this.getMode(name)
		}
		this.cachedModes = result
		return result
	}

	/**
	 * Returns true if both Electric and query paths are currently failing for this collection.
	 */
	isOffline(name: string): boolean {
		const state = this.getState(name)
		return state.electricOffline && state.queryOffline
	}

	/**
	 * Returns the names of all currently offline collections (both paths failing).
	 * Returns a cached array for referential stability (required by useSyncExternalStore).
	 */
	getOfflineCollections(): string[] {
		return this.cachedOffline
	}

	private computeOfflineCollections(): string[] {
		const result: string[] = []
		for (const [name, state] of this.states) {
			if (state.electricOffline && state.queryOffline) {
				result.push(name)
			}
		}
		return result
	}

	/**
	 * Force a specific collection into a given mode.
	 * 'auto' removes the override and restores automatic transitions.
	 */
	forceMode(name: string, mode: ForceMode): void {
		const state = this.getState(name)
		const previousEffectiveMode = this.getMode(name)
		state.forcedMode = mode
		const newEffectiveMode = this.getMode(name)

		if (previousEffectiveMode !== newEffectiveMode) {
			this.emitModeChange(name, newEffectiveMode)
		}
	}

	/**
	 * Force all tracked collections into the given mode simultaneously.
	 * 'auto' removes all overrides.
	 */
	forceAllMode(mode: ForceMode): void {
		for (const [name] of this.states) {
			this.forceMode(name, mode)
		}
	}

	/**
	 * Dynamically add a new collection to the tracker.
	 * No-op if the collection is already registered.
	 * Useful for per-task collections created after initialization (e.g. `artifacts:<taskId>`).
	 */
	addCollection(name: string): void {
		if (!this.states.has(name)) {
			this.states.set(name, {
				mode: 'electric',
				consecutiveSuccesses: 0,
				consecutiveErrors: 0,
				forcedMode: 'auto',
				electricOffline: false,
				queryOffline: false,
			})
			this.cachedModes = null
		}
	}

	/**
	 * Register a listener that fires whenever a collection's effective mode changes.
	 * Returns an unsubscribe function.
	 */
	onChange(listener: ModeChangeListener): () => void {
		this.modeListeners.add(listener)
		return () => {
			this.modeListeners.delete(listener)
		}
	}

	/**
	 * Register a listener that fires whenever a collection's offline state changes.
	 * Returns an unsubscribe function.
	 */
	onOfflineChange(listener: OfflineChangeListener): () => void {
		this.offlineListeners.add(listener)
		return () => {
			this.offlineListeners.delete(listener)
		}
	}
}
