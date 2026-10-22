import { describe, expect, test } from 'vitest'

import { exportDiffFeedback } from './export-diff-feedback'

describe('exportDiffFeedback', () => {
	test('places captured response-editor text before exact comment XML', () => {
		expect(
			exportDiffFeedback('  Please also check retries.  ', {
				xml: '<diff_comments>comments</diff_comments>',
				rootCommentIds: ['root-1'],
			}),
		).toEqual({
			text: 'Please also check retries.\n\n<diff_comments>comments</diff_comments>',
			rootCommentIds: ['root-1'],
		})
	})

	test('uses XML alone when the captured editor is empty', () => {
		expect(exportDiffFeedback('   ', { xml: '<diff_comments></diff_comments>', rootCommentIds: [] }).text).toBe(
			'<diff_comments></diff_comments>',
		)
	})
})
