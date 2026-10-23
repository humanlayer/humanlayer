import { RiptideApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { isContractProcedure } from '@orpc/contract'
import { implement, isProcedure } from '@orpc/server'

import type { ApiORPCClient } from '../orpc/client'

/** Route groups excluded from the CLI (not useful from the command line) */
const EXCLUDED_ROUTE_GROUPS = new Set(['metrics'])

const filteredContract = Object.fromEntries(
	Object.entries(RiptideApiContract).filter(([key]) => !EXCLUDED_ROUTE_GROUPS.has(key)),
) as typeof RiptideApiContract

const os = implement(filteredContract)

// ---------------------------------------------------------------------------
// CLI-side sync safety: default limits + required scope filters
// ---------------------------------------------------------------------------

const SYNC_DEFAULT_LIMIT = 1000

type WhereExpression =
	| { type: 'comparison'; field: string[]; operator: string; value?: unknown }
	| { type: 'and'; conditions: WhereExpression[] }
	| { type: 'or'; conditions: WhereExpression[] }
	| { type: 'not'; condition: WhereExpression }

/** Walk a WhereExpression AST to check if any comparison references one of the given fields */
function hasFieldComparison(expression: WhereExpression, fields: string[]): boolean {
	switch (expression.type) {
		case 'comparison':
			return fields.includes(expression.field[0] ?? '')
		case 'and':
		case 'or':
			return expression.conditions.some((c) => hasFieldComparison(c, fields))
		case 'not':
			return hasFieldComparison(expression.condition, fields)
	}
}

type SyncInput = { where?: WhereExpression; limit?: number; sorts?: unknown[]; offset?: number }

const CONVERSATION_EVENT_SCOPE_FIELDS = ['session_id', 'task_id', 'id']

/** Enforce default limit and required scope fields for sync endpoints before sending to the API */
function applySyncDefaults(endpointKey: string, input: SyncInput): SyncInput {
	const patched = { ...input, limit: input.limit ?? SYNC_DEFAULT_LIMIT }
	const requiredFields = endpointKey === 'conversationEvents' ? CONVERSATION_EVENT_SCOPE_FIELDS : undefined
	if (requiredFields) {
		if (!patched.where || !hasFieldComparison(patched.where, requiredFields)) {
			throw new Error(`sync ${endpointKey} requires a --where filter on one of: ${requiredFields.join(', ')}`)
		}
	}
	return patched
}

/**
 * Recursively walk the contract tree and build a server router
 * where each leaf handler proxies to the remote API via the oRPC client.
 * When inside the 'sync' route group, applies default limits and scope validation.
 */
function buildProxyRouter(
	contract: Record<string, unknown>,
	getClient: () => Promise<unknown>,
	osNode: Record<string, unknown>,
	parentGroup?: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(contract)) {
		if (isContractProcedure(value)) {
			// Leaf procedure — create a handler that delegates to the client
			const osLeaf = osNode[key] as
				| { handler: (fn: (opts: { input: unknown }) => Promise<unknown>) => unknown }
				| undefined
			if (!osLeaf) continue
			result[key] = osLeaf.handler(async ({ input }: { input: unknown }) => {
				try {
					const effectiveInput = parentGroup === 'sync' ? applySyncDefaults(key, input as SyncInput) : input
					const client = await getClient()
					const fn = (client as Record<string, (input: unknown) => Promise<unknown>>)[key] as (
						input: unknown,
					) => Promise<unknown>
					return await fn(effectiveInput)
				} catch (err) {
					// Re-throw with a proper message so Commander can display it
					const message = err instanceof Error ? err.message : String(err)
					throw new Error(message)
				}
			})
		} else {
			// Route group — recurse, narrowing both client and implementer paths
			result[key] = buildProxyRouter(
				value as Record<string, unknown>,
				async () => {
					const client = await getClient()
					return (client as Record<string, unknown>)[key]
				},
				osNode[key] as Record<string, unknown>,
				key,
			)
		}
	}

	return result
}

/**
 * Recursively strip output schemas from all procedures in a router tree.
 * The proxy returns JSON-deserialized data where bigints are strings,
 * which would fail z.bigint() validation. Since the real server already
 * validated, we skip re-validation in the CLI proxy.
 */
function stripOutputValidation(node: unknown): void {
	if (isProcedure(node)) {
		const orpc = (node as { '~orpc': { outputSchema?: unknown } })['~orpc']
		delete orpc.outputSchema
		return
	}
	if (node && typeof node === 'object') {
		for (const child of Object.values(node)) {
			stripOutputValidation(child)
		}
	}
}

/**
 * Create a full @orpc/server router that proxies every RiptideApiContract
 * procedure to the remote API via the provided lazy client.
 */
export function createProxyRouter(getClient: () => Promise<ApiORPCClient>) {
	const implementerTree = Object.fromEntries(Object.entries(os))
	const router = os.router(
		buildProxyRouter(filteredContract, getClient, implementerTree) as Parameters<typeof os.router>[0],
	)
	stripOutputValidation(router)
	return router
}
