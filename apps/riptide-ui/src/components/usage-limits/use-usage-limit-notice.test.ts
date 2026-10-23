import type { ClaudeUsageLimits } from '@humanlayer/schemas/zod/host/usage-limits'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'

import { USAGE_LIMIT_NOTICE_DISMISSED_KEY } from '@/lib/preferences'

import { useUsageLimitNotice } from './use-usage-limit-notice'

const HOUR = 3_600_000

const fiveHourAt = (usedPercent: number, resetsAt: number): ClaudeUsageLimits => ({
	checked_at: Date.now(),
	available: true,
	subscription_type: 'max',
	windows: {
		five_hour: {
			used_percent: usedPercent,
			resets_at: resetsAt,
			status: usedPercent >= 100 ? 'rejected' : 'allowed',
		},
	},
})

function renderNotice(hostUsageLimits: ClaudeUsageLimits | null, isParked = false) {
	return renderHook(() =>
		useUsageLimitNotice({ hostUsageLimits, model: null, resolvedModel: null, isParked, suppressed: false }),
	)
}

describe('useUsageLimitNotice', () => {
	beforeEach(() => {
		localStorage.removeItem(USAGE_LIMIT_NOTICE_DISMISSED_KEY)
	})

	test('a dismissal in one session hides the notice in every other session', () => {
		const limits = fiveHourAt(90, Date.now() + HOUR)
		const first = renderNotice(limits)
		const second = renderNotice(limits)
		expect(first.result.current.show).toBe(true)
		expect(second.result.current.show).toBe(true)

		act(() => first.result.current.onDismiss())

		expect(first.result.current.show).toBe(false)
		expect(second.result.current.show).toBe(false)
		expect(renderNotice(limits).result.current.show).toBe(false)
	})

	test('a later reset brings the notice back', () => {
		const resetsAt = Date.now() + HOUR
		const notice = renderNotice(fiveHourAt(90, resetsAt))
		act(() => notice.result.current.onDismiss())

		expect(renderNotice(fiveHourAt(95, resetsAt)).result.current.show).toBe(false)
		expect(renderNotice(fiveHourAt(90, resetsAt + 5 * HOUR)).result.current.show).toBe(true)
	})

	test('shows a parked session whose limit already reset until it is dismissed', () => {
		const limits = fiveHourAt(100, Date.now() - HOUR)
		const parked = renderNotice(limits, true)
		expect(parked.result.current.show).toBe(true)

		act(() => parked.result.current.onDismiss())

		expect(renderNotice(limits, true).result.current.show).toBe(false)
	})

	test('survives a reload', () => {
		const notice = renderNotice(fiveHourAt(90, Date.now() + HOUR))
		act(() => notice.result.current.onDismiss())

		const persisted = JSON.parse(localStorage.getItem(USAGE_LIMIT_NOTICE_DISMISSED_KEY) ?? '{}')
		expect(Object.keys(persisted)).toEqual([expect.stringMatching(/^five_hour:\d+$/)])
	})
})
