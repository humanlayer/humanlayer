import { journalOverlapMethod } from './evidence/journal-overlap/method'
import type { AttributionMethod, AttributionMethodName, CommitForAttribution } from './evidence/method'
import { trailerMethod } from './evidence/trailer/method'

/**
 * The ledger tiers (the DB's `attribution_method` column values). The tier is the WHOLE outside
 * contract, privacy included: `confirmed` and `inferred` name a session and keep the full row;
 * `human` means no method claimed the commit — bystander work whose content never ships. Callers
 * MUST redact `human` rows to counting fields before transmission (see ./redact-human-commit).
 * There is deliberately no kept-but-unclaimed middle class: even a commit carrying our own
 * trailer token with an unparseable value just heaps with the human commits.
 */
export type AttributionTier = 'confirmed' | 'inferred' | 'human'

/**
 * THE attribution sequencer — the one place that says which methods exist, which are enabled,
 * the order they run in, and the ledger tier each one's claim books as. The registry below IS
 * the chain: reading it top to bottom is reading the algorithm, and the methods themselves
 * return tier-free evidence (see MethodClaim) so this literal cannot drift from the behavior.
 *
 * Order IS priority: each method is strictly stronger evidence than the next, and the first
 * claim wins; a commit no enabled method claims falls through to unclaimed `human`. To
 * isolate a misbehaving method, flip its `enabled` literal here (or pass `disabledMethods` at
 * a call site for a single run) — the chain simply skips it, and every commit it would have
 * claimed falls through. Nothing else in the package reads these flags, so a disable can
 * never half-apply.
 */
export const ATTRIBUTION_METHODS: ReadonlyArray<{
	readonly enabled: boolean
	readonly method: AttributionMethod
	/** What a claim from this method books as — the meaning of the evidence, owned HERE. */
	readonly tier: AttributionTier
}> = [
	{ enabled: true, method: trailerMethod, tier: 'confirmed' }, // the message names the committing session
	{ enabled: true, method: journalOverlapMethod, tier: 'inferred' }, // added lines match a session's journal
]

/**
 * Bump when the attribution algorithm changes (normalization, hashing, the inferred-tier gate,
 * the overlap heuristic, or the method chain itself). Persisted per-row so trend charts never
 * silently shift when the algorithm evolves; old rows keep their version.
 *
 * v2: replaced the v1 any-overlap floor (INFERRED_FLOOR = 1) with journal-overlap's dual gate,
 * and made exact-overlap ties resolve deterministically by session id.
 */
export const ATTRIBUTION_ALGORITHM_VERSION = 2

export type AttributionResult = {
	/**
	 * The ledger tier — and the privacy verdict with it: `human` rows MUST be redacted to
	 * counting fields before transmission (see {@link AttributionTier}).
	 */
	tier: AttributionTier
	sessionId?: string
	confidence: number
	aiAttributedLines: number
}

/**
 * Attribute one commit by running the enabled methods in sequence; first claim wins.
 *
 * `disabledMethods` skips methods for THIS call only (tests, or a caller isolating misbehavior
 * at runtime) — the durable switch is the `enabled` literal in {@link ATTRIBUTION_METHODS}.
 */
export function attributeCommit(
	commit: CommitForAttribution,
	options?: { readonly disabledMethods?: ReadonlyArray<AttributionMethodName> },
): AttributionResult {
	for (const { enabled, method, tier } of ATTRIBUTION_METHODS) {
		if (!enabled || options?.disabledMethods?.includes(method.name)) continue
		const claim = method.claim(commit)
		if (claim) return { ...claim, tier }
	}
	return { tier: 'human', confidence: 0, aiAttributedLines: 0 }
}
