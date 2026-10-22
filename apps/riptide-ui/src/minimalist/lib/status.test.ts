import type { Session } from '@humanlayer/db/tables/sessions'
import { describe, expect, it } from 'vitest'

import { statusAnnouncement, stopReason } from '@/minimalist/lib/status'

type Stopped = Parameters<typeof stopReason>[0]

function session(fields: Partial<Stopped>): Stopped {
	return {
		status: 'failed',
		error_message: null,
		error_reason: null,
		coding_agent: 'claude' as Session['coding_agent'],
		...fields,
	}
}

describe('stopReason', () => {
	it('says nothing for a session that is working or finished', () => {
		expect(stopReason(session({ status: 'running' }), 'mac')).toBeNull()
		expect(stopReason(session({ status: 'ready_for_input' }), 'mac')).toBeNull()
	})

	it('tells you to send a message to a stalled session', () => {
		expect(stopReason(session({ status: 'lost', error_message: 'no events in 10 minutes' }), 'mac')).toMatchObject({
			title: 'The agent stopped responding',
		})
	})

	it('offers the sign-in command for the agent that signed out', () => {
		expect(stopReason(session({ error_reason: 'auth_required' }), 'mac')).toMatchObject({
			title: 'Claude is signed out on mac',
			command: 'claude /login',
		})
		const codex = session({ coding_agent: 'codelayer', error_message: 'Missing auth for provider: codex' })
		expect(stopReason(codex, 'mac')).toMatchObject({ title: 'Codex is signed out on mac' })
	})

	it('names an agent that could not start, and shows any other error as is', () => {
		expect(stopReason(session({ error_reason: 'start_failed' }), 'mac')?.title).toBe('Claude Code could not start')
		expect(stopReason(session({ error_message: 'Tool crashed' }), 'mac')).toMatchObject({
			title: 'The agent stopped with an error',
			error: 'Tool crashed',
		})
	})
})

describe('statusAnnouncement', () => {
	it('says what changed in words a listener can act on', () => {
		expect(statusAnnouncement('ready_for_input')).toBe('The agent finished')
		expect(statusAnnouncement('needs_approval')).toBe('The agent needs your approval')
		expect(statusAnnouncement('resuming')).toBe('The agent is working')
		expect(statusAnnouncement('interrupted')).toBe('Interrupted')
	})
})
