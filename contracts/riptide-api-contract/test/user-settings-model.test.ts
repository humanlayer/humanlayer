import { describe, expect, it } from 'vitest'

import { UpdateUserSettingsInputSchema } from '../src/api/auth/user/settings-update'

describe('user settings model contract', () => {
	it('accepts Opus 5.5 as the default Claude model', () => {
		expect(UpdateUserSettingsInputSchema.parse({ defaultModel: 'claude-opus-5-5' })).toEqual({
			defaultModel: 'claude-opus-5-5',
		})
	})
})
