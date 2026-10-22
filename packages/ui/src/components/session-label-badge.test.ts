import { describe, expect, test } from 'vitest'
import { getPhaseColor } from './workflow-graph/utils'
import { getLabelColor } from './session-label-badge'

const expectedColors = {
	'rpi:research-questions': 'var(--terminal-label-blue, var(--terminal-accent))',
	'rpi:research': 'var(--terminal-label-green, var(--terminal-success))',
	'rpi:design': 'var(--terminal-label-purple, var(--terminal-accent-alt))',
	'rpi:structure': 'var(--terminal-label-pink, var(--terminal-warning))',
	'rpi:implementation': 'var(--terminal-label-green, var(--terminal-success))',
	'rpi:describe-pr': 'var(--terminal-label-blue, var(--terminal-color-12))',
} as const

describe('phase label colors', () => {
	test('keeps session badges and workflow nodes on the same semantic phase colors', () => {
		for (const [label, color] of Object.entries(expectedColors)) {
			expect(getLabelColor(label)).toBe(color)
			expect(getPhaseColor(label)).toBe(color)
		}
	})
})
