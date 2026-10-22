import { describe, expect, test } from 'vitest'

import { handoffBlockedReason, handoffTarget, handoffTitle, type HandoffSession } from './harness-handoff'

function session(overrides: Partial<HandoffSession> = {}): HandoffSession {
	return {
		coding_agent: 'claude',
		provider: 'anthropic',
		status: 'ready_for_input',
		archived: false,
		...overrides,
	}
}

describe('handoffTarget', () => {
	test('claude hands off to codelayer', () => {
		expect(handoffTarget(session({ coding_agent: 'claude' }))).toBe('codelayer')
	})

	test('codex codelayer hands off to claude', () => {
		expect(handoffTarget(session({ coding_agent: 'codelayer', provider: 'codex' }))).toBe('claude')
	})

	test('non-codex codelayer cannot hand off', () => {
		expect(handoffTarget(session({ coding_agent: 'codelayer', provider: 'anthropic' }))).toBeNull()
	})

	test('a codex session hands off without a coding agent session id', () => {
		const codexSession: HandoffSession & { coding_agent_session_id: string | null } = {
			...session({ coding_agent: 'codelayer', provider: 'codex' }),
			coding_agent_session_id: null,
		}
		expect(handoffTarget(codexSession)).toBe('claude')
	})
})

describe('handoffBlockedReason', () => {
	test('allows an idle, owned, online session', () => {
		expect(handoffBlockedReason(session(), true, false)).toBeNull()
	})

	test('blocks non-owners', () => {
		expect(handoffBlockedReason(session(), false, false)).toBe('Only the session owner can hand off.')
	})

	test('blocks while the host is offline', () => {
		expect(handoffBlockedReason(session(), true, true)).toBe('Connect the host to hand off.')
	})

	test('blocks a running session', () => {
		expect(handoffBlockedReason(session({ status: 'running' }), true, false)).toBe(
			'Interrupt the session or wait for input before handing off.',
		)
	})

	test('blocks a session parked on a usage limit', () => {
		expect(handoffBlockedReason(session({ status: 'waiting_for_usage_limit' }), true, false)).toBe(
			'Interrupt the session or wait for input before handing off.',
		)
	})

	test('blocks an archived session', () => {
		expect(handoffBlockedReason(session({ archived: true }), true, false)).toBe(
			'Unarchive the session to hand off.',
		)
	})
})

describe('handoffTitle', () => {
	test('appends the target agent to the source title', () => {
		expect(handoffTitle('Fix the auth bug', 'Codex')).toBe('Fix the auth bug (Codex)')
	})

	test('stays empty when the source has no title', () => {
		expect(handoffTitle(null, 'Codex')).toBeNull()
		expect(handoffTitle('', 'Claude Code')).toBeNull()
	})
})
