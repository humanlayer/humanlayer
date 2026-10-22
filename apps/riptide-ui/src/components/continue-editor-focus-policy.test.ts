import { expect, test } from 'vitest'

import { getContinueEditorAutoFocus } from './continue-editor-focus-policy'

test('the continue editor leaves initial DOM focus on the page keyboard owner', () => {
	expect(getContinueEditorAutoFocus()).toBeUndefined()
})
