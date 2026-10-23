import { describe, expect, test } from 'vitest'

import { buildS3Key } from '../../src/lib/s3-key-builder'

describe('buildS3Key', () => {
	test('builds an S3 key for a root-level artifact', () => {
		expect(buildS3Key('org-123', 'task-456', 'plan.md')).toBe('org-123/task-456/plan.md')
	})

	test('builds an S3 key for a nested artifact subpath', () => {
		expect(buildS3Key('org-123', 'task-456', 'research/plan.md')).toBe('org-123/task-456/research/plan.md')
	})

	test('rejects invalid subpaths', () => {
		expect(() => buildS3Key('org-123', 'task-456', '../plan.md')).toThrow()
		expect(() => buildS3Key('org-123', 'task-456', 'research//plan.md')).toThrow()
	})
})
