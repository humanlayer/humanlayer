import { describe, expect, it } from 'vitest'

import { splitAttachments, withAttachments } from '@/minimalist/lib/attachments'

describe('splitAttachments', () => {
	it('pulls uploads out of a sent message', () => {
		const sent = withAttachments('Why does this fail?', 'fix-1a2b', [
			{ fileName: 'uploads/01-shot.png', contentType: 'image/png', fileSizeBytes: 1, contentHash: 'x' },
		])
		expect(splitAttachments(sent)).toEqual({ text: 'Why does this fail?', files: ['uploads/01-shot.png'] })
	})

	it('reads uploads mentioned inline and keeps document mentions', () => {
		expect(
			splitAttachments('See @.humanlayer/tasks/s/uploads/a.png and @.humanlayer/tasks/s/01-plan.md please'),
		).toEqual({ text: 'See and @.humanlayer/tasks/s/01-plan.md please', files: ['uploads/a.png'] })
	})

	it('leaves a message with only files empty', () => {
		expect(splitAttachments('@.humanlayer/tasks/s/uploads/a.pdf')).toEqual({ text: '', files: ['uploads/a.pdf'] })
	})
})
