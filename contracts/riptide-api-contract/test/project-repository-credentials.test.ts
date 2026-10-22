import { describe, expect, test } from 'vitest'

import { projectMutationFieldsSchema } from '../src/api/projects-v2/schemas'
import { CreateTaskV2InputSchema } from '../src/api/tasks/v2/create'

describe('repository credential API boundaries', () => {
	test.each([
		['https://secret-token@github.com/org/repo.git', false],
		['https://user:secret-token@github.com/org/repo.git', false],
		['ssh://git:secret-token@github.com/org/repo.git', false],
		['https://github.com/org/repo.git', true],
		['git@github.com:org/repo.git', true],
		['ssh://git@github.com/org/repo.git', true],
	])('enforces safe project and task recipes for %s', (remoteUrl, accepted) => {
		const repository = {
			remoteUrl,
			repositoryIdentity: 'github.com/org/repo',
			defaultBranch: 'main',
			default: true,
			autoPushBranch: false,
			copyGlobs: [],
		}
		const projectResult = projectMutationFieldsSchema.safeParse({
			name: 'Repository credentials',
			private: false,
			repositories: [repository],
		})
		const taskResult = CreateTaskV2InputSchema.safeParse({
			taskId: '01900000-0000-7000-8000-000000000001',
			workspaceId: '01900000-0000-7000-8000-000000000002',
			projectId: '01900000-0000-7000-8000-000000000003',
			name: 'Repository credentials',
			slug: 'repository-credentials',
			repositories: [{ ...repository, branch: 'test' }],
			firstSession: { hostId: 'host', text: 'Implement', codingAgent: 'claude', permissionsMode: 'default' },
		})
		for (const result of [projectResult, taskResult]) {
			expect(result.success).toBe(accepted)
			if (!result.success) {
				expect(result.error.issues.map((issue) => issue.message)).toEqual([
					'Repository URLs must not contain embedded credentials',
				])
				expect(result.error.message).not.toContain('secret-token')
			}
		}
	})
})
