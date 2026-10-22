import { describe, expect, test } from 'vitest'

import {
	buildCreatedWithExperimentFlags,
	CreatedWithExperimentFlagsSchema,
	getTaskComposerSnapshot,
} from '../src/api/tasks/experiment-flags'

const snapshot = { assigned_group: 'v2_form', actual_form: 'v2_form_mobile' } as const

describe('task composer experiment flags', () => {
	test('builds and reads the narrow task composer snapshot', () => {
		const flags = buildCreatedWithExperimentFlags(snapshot)
		expect(flags).toEqual({ task_composer: snapshot })
		expect(getTaskComposerSnapshot(flags)).toEqual(snapshot)
	})

	test.each([
		{},
		{ task_composer: { assigned_group: 'other', actual_form: 'v2_form' } },
		{ task_composer: { assigned_group: 'v2_form', actual_form: 'other' } },
		{ task_composer: { ...snapshot, override: 'force-off' } },
		{ task_composer: snapshot, workflow_selector: {} },
	])('rejects snapshots outside the agreed shape', (value) => {
		expect(CreatedWithExperimentFlagsSchema.safeParse(value).success).toBe(false)
	})
})
