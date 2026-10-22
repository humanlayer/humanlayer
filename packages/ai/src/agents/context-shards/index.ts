/**
 * Context Shards Inference Agent
 *
 * Proposes reusable organization-level steering instructions ("context shards")
 * from already-tagged conversation evidence using one direct Anthropic Haiku
 * call. Stateless: callers supply tagged evidence and exclusions and later
 * resolve citation tags back to source rows themselves.
 */

export {
	ContextShardInferenceError,
	type ContextShardInferenceInput,
	type ContextShardInferenceOutput,
	type ContextShardMessageId,
	type GenerateContextShardCandidates,
	generateContextShardCandidates,
	renderContextShardInferencePrompt,
} from './generate-context-shard-candidates'
