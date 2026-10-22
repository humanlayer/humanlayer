import { codingTools } from '@humanlayer/fold-agent'
import { codexModel } from '@humanlayer/fold-codex'
import { AgentId, defineTool, deriveChildPromptCacheKey, subagentCapabilitiesOf } from '@humanlayer/fold-core'
import { xaiModel } from '@humanlayer/fold-xai'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeFoldAgentDelegation } from '@/effects/services/fold-sessions/fold-agent-tool'

describe('Fold agent delegation', () => {
	it.each(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'])(
		'uses the exact %s descriptor for every specialist',
		(modelId) => {
			const model = codexModel({ model: modelId, reasoning: 'max' })
			const delegation = makeFoldAgentDelegation({
				model,
				codingTools: codingTools({ cwd: '/tmp/riptide-fold-gpt-6-delegation' }),
				sharedSkillTool: defineTool({ name: 'skill', description: 'test skill', handler: () => Effect.void }),
				productTools: [],
				hooks: {},
				systemPrompt: 'test prompt',
			})

			for (const specialist of delegation.specialists) {
				expect(specialist.model).not.toBeTypeOf('string')
				if (typeof specialist.model === 'string') continue
				expect(specialist.model.activeModel).toMatchObject({
					providerKind: 'codex',
					modelId,
					requestedReasoningLevel: 'max',
				})
			}
		},
	)

	it('enforces fork depth and specialist isolation through tool composition', () => {
		const sharedSkillTool = defineTool({ name: 'skill', description: 'test skill', handler: () => Effect.void })
		const productTool = defineTool({
			name: 'get_artifact_comments',
			description: 'test product tool',
			handler: () => Effect.void,
		})
		const delegation = makeFoldAgentDelegation({
			model: codexModel({ model: 'gpt-5.3-codex', reasoning: 'high' }),
			codingTools: codingTools({ cwd: '/tmp/riptide-fold-delegation' }),
			sharedSkillTool,
			productTools: [productTool],
			hooks: {},
			systemPrompt: 'test prompt',
		})

		const rootCapabilities = subagentCapabilitiesOf(delegation.rootAgentTool)
		expect(rootCapabilities?.forkAgent?.id).toBe('humanlayer-fork-delegating')
		expect(rootCapabilities?.agents.map((agent) => agent.name)).toEqual([
			'general-purpose',
			'bash',
			'rpi:implementer-agent',
			'rpi:outline-implementer-agent',
			'rpi:codebase-locator',
			'rpi:codebase-analyzer',
			'rpi:codebase-pattern-finder',
			'web-search-researcher',
		])

		const childAgentTool = delegation.delegatingFork.tools.find((tool) => tool.name === 'subagent')
		expect(childAgentTool).toBeDefined()
		expect(childAgentTool && subagentCapabilitiesOf(childAgentTool)?.forkAgent?.id).toBe('humanlayer-fork-leaf')
		expect(delegation.leafFork.tools.some((tool) => tool.name === 'subagent')).toBe(false)
		expect(delegation.specialists.every((agent) => agent.tools?.every((tool) => tool.name !== 'subagent'))).toBe(
			true,
		)
		expect(delegation.leafFork.tools.map((tool) => tool.name)).toContain('skill')
		expect(delegation.leafFork.tools.map((tool) => tool.name)).toContain('get_artifact_comments')
		expect(
			delegation.specialists.every((agent) => agent.tools?.some((tool) => tool.name === 'get_artifact_comments')),
		).toBe(true)
	})

	it('derives stable bounded cache keys for durable children', async () => {
		const childId = Schema.decodeSync(AgentId)('agent_01kylemistele0123456789')
		const siblingId = Schema.decodeSync(AgentId)('agent_02kylemistele0123456789')
		const first = await Effect.runPromise(deriveChildPromptCacheKey('session-root-affinity', childId))
		const resumed = await Effect.runPromise(deriveChildPromptCacheKey('session-root-affinity', childId))
		const sibling = await Effect.runPromise(deriveChildPromptCacheKey('session-root-affinity', siblingId))

		expect(resumed).toBe(first)
		expect(sibling).not.toBe(first)
		expect(first.length).toBeLessThanOrEqual(64)
	})

	it('runs Grok subagents at low reasoning except the outline implementer', () => {
		const model = xaiModel({ model: 'grok-4.6', reasoning: 'high' })
		const subagentModel = xaiModel({ model: 'grok-4.6', reasoning: 'low' })
		const delegation = makeFoldAgentDelegation({
			model,
			subagentModel,
			codingTools: codingTools({ cwd: '/tmp/riptide-fold-grok-delegation' }),
			sharedSkillTool: defineTool({ name: 'skill', description: 'test skill', handler: () => Effect.void }),
			productTools: [],
			hooks: {},
			systemPrompt: 'test prompt',
		})

		for (const specialist of delegation.specialists) {
			const expectedReasoning = specialist.name === 'rpi:outline-implementer-agent' ? 'high' : 'low'
			expect(specialist.model).not.toBeTypeOf('string')
			if (typeof specialist.model === 'string') continue
			expect(specialist.model.activeModel).toMatchObject({
				modelId: 'grok-4.6',
				requestedReasoningLevel: expectedReasoning,
			})
		}
	})
})
