import type { Session } from '@humanlayer/db/tables/sessions'
import { describe, expect, it } from 'vitest'

import { DEFAULT_EFFECTIVE_SETTINGS } from '@/agents/claudecode/effective-settings'
import { transformClaudeContentBlock } from '@/effects/services/claude-sessions/event-transformations'
import { buildClaudeQueryOptions } from '@/effects/services/claude-sessions/query-options'

import { makeBasicEffectSession } from '../fixtures/effect-claude-runtime'

const baseQueryInput = (session: Session) => ({
	session,
	effectiveSettings: DEFAULT_EFFECTIVE_SETTINGS,
	pathToClaudeCodeExecutable: '/tmp/claude',
	cwd: '/workspace/repo-a',
	rpiPluginPath: '/tmp/rpi-plugin',
	humanlayerPluginPath: '/tmp/humanlayer-plugin',
	additionalDirectories: ['/workspace/repo-b'],
	systemPromptAdditions: ['context'],
	inheritedEnv: { PATH: '/bin' },
})

describe('Effect Claude task session preparation', () => {
	it('derives ordinary, resumed, and forked query options deterministically', () => {
		const session = makeBasicEffectSession({ model: 'claude-opus-4-6-1m', effort: 'xhigh' })
		const ordinary = buildClaudeQueryOptions(baseQueryInput(session))
		const resumed = buildClaudeQueryOptions({ ...baseQueryInput(session), resumeSessionId: 'resume-1' })
		const forked = buildClaudeQueryOptions({
			...baseQueryInput(session),
			resumeSessionId: 'ignored-resume',
			forkMeta: {
				agent: 'claude',
				forkFromCodingAgentSessionId: 'fork-source',
				forkAtCodingAgentEventId: 'fork-event',
			},
		})

		expect(ordinary).toMatchObject({
			model: 'claude-opus-4-6[1m]',
			effort: 'xhigh',
			resume: undefined,
			additionalDirectories: ['/workspace/repo-b'],
			includePartialMessages: true,
			forwardSubagentText: true,
			tools: expect.arrayContaining(['Agent', 'ListAgents', 'SendMessage', 'Monitor', 'Workflow']),
			plugins: [
				{ type: 'local', path: '/tmp/rpi-plugin' },
				{ type: 'local', path: '/tmp/humanlayer-plugin' },
			],
		})
		expect(resumed.resume).toBe('resume-1')
		expect(forked).toMatchObject({
			resume: 'fork-source',
			forkSession: true,
			resumeSessionAt: 'fork-event',
		})
	})

	it('runs pinned Sonnet 5.5 with adaptive thinking instead of a thinking budget', () => {
		const session = makeBasicEffectSession({ model: 'claude-sonnet-5-5', effort: 'high' })
		const ordinary = buildClaudeQueryOptions(baseQueryInput(session))
		const resumed = buildClaudeQueryOptions({ ...baseQueryInput(session), resumeSessionId: 'resume-sonnet-5-5' })

		for (const options of [ordinary, resumed]) {
			expect(options).toMatchObject({
				model: 'claude-sonnet-5-5',
				effort: 'high',
				thinking: { type: 'adaptive' },
			})
		}
	})

	it('keeps pinned Opus 5.5 across launch, resume, and fork with adaptive thinking', () => {
		const session = makeBasicEffectSession({ model: 'claude-opus-5-5', effort: 'max' })
		const ordinary = buildClaudeQueryOptions(baseQueryInput(session))
		const resumed = buildClaudeQueryOptions({ ...baseQueryInput(session), resumeSessionId: 'resume-5-5' })
		const forked = buildClaudeQueryOptions({
			...baseQueryInput(session),
			forkMeta: {
				agent: 'claude',
				forkFromCodingAgentSessionId: 'fork-source-5-5',
				forkAtCodingAgentEventId: 'fork-event-5-5',
			},
		})

		for (const options of [ordinary, resumed, forked]) {
			expect(options).toMatchObject({
				model: 'claude-opus-5-5',
				effort: 'max',
				thinking: { type: 'adaptive' },
				env: { CLAUDE_CODE_EFFORT_LEVEL: 'max' },
			})
		}
		expect(resumed.resume).toBe('resume-5-5')
		expect(forked).toMatchObject({
			resume: 'fork-source-5-5',
			forkSession: true,
			resumeSessionAt: 'fork-event-5-5',
		})
	})

	it('keeps tool calls before their matching tool results', () => {
		const events = [
			transformClaudeContentBlock({
				sessionId: 'session-1',
				codingAgentSessionId: 'claude-1',
				role: 'assistant',
				content: { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'ticket.md' } },
			}),
			transformClaudeContentBlock({
				sessionId: 'session-1',
				codingAgentSessionId: 'claude-1',
				role: 'user',
				content: { type: 'tool_result', tool_use_id: 'tool-1', content: 'ticket contents' },
			}),
		]

		expect(events.map((event) => event?.eventType)).toEqual(['tool_call', 'tool_result'])
		expect(events[1]).toMatchObject({ toolResultForId: 'tool-1' })
	})
})
