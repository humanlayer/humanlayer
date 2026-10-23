import { ORPCError } from '@orpc/client'
import { uuidv7 } from 'uuidv7'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { getRejectedTaskCreationError, getTaskCreationError } from './task-creation-error'

describe('getTaskCreationError', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	test('keeps timeout wording only for Electric confirmation timeouts', () => {
		expect(getTaskCreationError({ name: 'TimeoutWaitingForTxIdError' }, 'Sync timed out')).toEqual({
			errorMessage: 'Sync timed out',
		})
	})

	test('extracts typed task-create lookup failures and settings hint', () => {
		vi.stubEnv('VITE_PUBLIC_CLOUD_ORIGIN', 'https://cloud.example.com')
		expect(
			getTaskCreationError(
				{
					code: 'NOT_FOUND',
					data: {
						message: 'Linear ticket unavailable',
						resolutionHint: { text: 'Check Linear', anchorText: 'settings' },
					},
				},
				'Sync timed out',
			),
		).toEqual({
			errorMessage: 'Linear ticket unavailable',
			resolutionHint: {
				text: 'Check Linear',
				url: 'https://cloud.example.com/settings',
				anchorText: 'settings',
			},
		})
	})

	test('shows the server message for a form-composer slug conflict', () => {
		const error = new ORPCError('TASK_SLUG_CONFLICT', {
			defined: true,
			status: 409,
			data: { slug: 'build-agents', message: 'The name "build-agents" is taken.' },
		})
		expect(getTaskCreationError(error, 'Sync timed out')).toEqual({
			errorMessage: 'The name "build-agents" is taken.',
		})
	})

	test('shows the server message for a draft launch conflict', () => {
		const error = new ORPCError('TASK_LAUNCH_CONFLICT', {
			defined: true,
			status: 409,
			data: { draftId: uuidv7(), reason: 'task-id-in-use', message: 'This draft was already launched.' },
		})
		expect(getTaskCreationError(error, 'Sync timed out')).toEqual({
			errorMessage: 'This draft was already launched.',
		})
	})

	test('falls back to the generic message when a conflict carries no message', () => {
		const error = new ORPCError('TASK_LAUNCH_CONFLICT', { defined: true, status: 409, data: {} })
		expect(getTaskCreationError(error, 'Sync timed out')).toEqual({ errorMessage: 'Task creation failed.' })
	})

	test('maps a definite rejection without a timeout message', () => {
		const error = new ORPCError('TASK_SLUG_CONFLICT', {
			defined: true,
			status: 409,
			data: { slug: 'build-agents', message: 'The name "build-agents" is taken.' },
		})
		expect(getRejectedTaskCreationError(error)).toEqual({ errorMessage: 'The name "build-agents" is taken.' })
		expect(getRejectedTaskCreationError({ code: 'INTERNAL_SERVER_ERROR' })).toEqual({
			errorMessage: 'Task creation failed.',
		})
	})

	test('uses a generic message for unknown server rejections', () => {
		expect(getTaskCreationError({ code: 'INTERNAL_SERVER_ERROR' }, 'Sync timed out')).toEqual({
			errorMessage: 'Task creation failed.',
		})
	})
})
