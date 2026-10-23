import { describe, expect, test } from 'vitest'

import { CreateTaskV2InputSchema } from '../src/api/tasks/v2/create'

const validInput = {
	taskId: '01900000-0000-7000-8000-000000000001',
	workspaceId: '01900000-0000-7000-8000-000000000002',
	projectId: '01900000-0000-7000-8000-000000000003',
	name: 'Workspace path task',
	slug: 'workspace path [manually-edited]!',
	repositories: [
		{
			remoteUrl: 'https://github.com/org/repo.git',
			repositoryIdentity: 'github.com/org/repo',
			defaultBranch: 'main',
			branch: 'test',
			default: true,
			autoPushBranch: false,
			copyGlobs: [],
		},
	],
	firstSession: { hostId: 'host', text: 'Implement', codingAgent: 'claude', permissionsMode: 'default' },
}

describe('CreateTaskV2InputSchema slug', () => {
	test('requires a slug and trims it', () => {
		expect(CreateTaskV2InputSchema.safeParse({ ...validInput, slug: undefined }).success).toBe(false)
		expect(CreateTaskV2InputSchema.parse({ ...validInput, slug: '  readable-task  ' }).slug).toBe('readable-task')
	})

	test.each(['', '   ', '.', '..', 'nested/path', 'nested\\path', 'nul\0segment', 'x'.repeat(101), '界'.repeat(86)])(
		'rejects unsafe slug %j',
		(slug) => {
			expect(CreateTaskV2InputSchema.safeParse({ ...validInput, slug }).success).toBe(false)
		},
	)

	test('permits manually edited characters within one path segment', () => {
		expect(CreateTaskV2InputSchema.safeParse(validInput).success).toBe(true)
	})
})
