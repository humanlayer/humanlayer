import { SESSION_STATUSES } from '@humanlayer/schemas/zod/session/session-status'
import { describe, expect, test } from 'vitest'

import { SESSION_STATUS_LABELS, sessionStatusLabel, type SessionStatusHost } from './session-status-label'

const remote = (state: SessionStatusHost['state']): SessionStatusHost => ({
	state,
	hostLabel: 'workstation',
	isLocal: false,
})
const thisDevice = (state: SessionStatusHost['state']): SessionStatusHost => ({
	state,
	hostLabel: 'MacBook',
	isLocal: true,
})

describe('sessionStatusLabel', () => {
	test.each(SESSION_STATUSES)('%s has a sentence-case label', (status) => {
		const label = sessionStatusLabel(status)
		expect(label).toBe(SESSION_STATUS_LABELS[status])
		expect(label).toMatch(/^[A-Z][a-z]/)
		expect(label).not.toContain('_')
	})

	test('maps every status to human copy', () => {
		expect(SESSION_STATUS_LABELS).toEqual({
			draft: 'Draft',
			ready_for_launch: 'Queued',
			waiting_for_workspace: 'Preparing workspace',
			launching: 'Starting',
			resuming: 'Starting',
			running: 'Running',
			ready_for_input: 'Idle',
			needs_approval: 'Needs approval',
			waiting_for_usage_limit: 'Usage limit reached',
			interrupt_requested: 'Interrupting',
			interrupted: 'Interrupted',
			failed: 'Failed',
			lost: 'Stalled',
		})
	})

	test('a queued session says what it waits for', () => {
		expect(sessionStatusLabel('ready_for_launch', remote('online'))).toBe('Starting')
		expect(sessionStatusLabel('ready_for_launch', thisDevice('starting'))).toBe('Waiting for this device to start')
		expect(sessionStatusLabel('ready_for_launch', remote('updating'))).toBe('Waiting for workstation to update')
		expect(sessionStatusLabel('ready_for_launch', remote('offline'))).toBe('Waiting for workstation to reconnect')
		expect(sessionStatusLabel('ready_for_launch', thisDevice('offline'))).toBe(
			'Waiting for this device to reconnect',
		)
		expect(sessionStatusLabel('ready_for_launch')).toBe('Queued')
	})

	test('host state does not change other statuses', () => {
		expect(sessionStatusLabel('running', remote('offline'))).toBe('Running')
		expect(sessionStatusLabel('ready_for_input', thisDevice('starting'))).toBe('Idle')
	})

	test('a missing or unknown status has no label', () => {
		expect(sessionStatusLabel(undefined)).toBeNull()
		expect(sessionStatusLabel('waiting_for_agent')).toBeNull()
	})
})
