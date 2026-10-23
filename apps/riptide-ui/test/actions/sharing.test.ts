import type { ArtifactMetadata } from '@humanlayer/db/tables/artifacts'
import type { TaskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import type { TaskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import type { Task } from '@humanlayer/db/tables/tasks'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'

import { createSharingActions } from '@/actions/sharing'

type SharingActionParams = Parameters<typeof createSharingActions>
type SharingApi = SharingActionParams[4]

function testCollection<T extends { id: string }>() {
	return createCollection(
		localOnlyCollectionOptions<T>({
			id: crypto.randomUUID(),
			getKey: (row) => row.id,
		}),
	)
}

function makeArtifact(): ArtifactMetadata {
	return {
		id: 'artifact-1',
		task_id: 'task-1',
		task_slug: null,
		resource_owner_user_id: 'user-1',
		organization_id: 'org-1',
		file_name: 'artifact.md',
		content_hash: 'hash',
		frontmatter: {},
		created_by: 'user-1',
		created_at: 1n,
		last_updated_at: 1n,
		share_key: null,
		shared_by: null,
		share_enabled: false,
		public_permission: 'off',
		is_deleted: false,
		storage_type: 'postgres',
		s3_key: null,
		content_type: null,
		file_size_bytes: null,
	}
}

function makeActions(update: SharingApi['sharing']['artifact']['update']) {
	const artifacts = testCollection<ArtifactMetadata>()
	artifacts.insert(makeArtifact())
	const actions = createSharingActions(
		testCollection<TaskOrganizationAcl>(),
		testCollection<TaskUserAcl>(),
		testCollection<Task>(),
		artifacts,
		{
			sharing: {
				organization: { update: vi.fn<SharingApi['sharing']['organization']['update']>() },
				user: { update: vi.fn<SharingApi['sharing']['user']['update']>() },
				artifact: { update },
			},
		},
		'user-1',
		'org-1',
		async () => {},
		async () => {},
		async () => {},
	)
	return { actions, artifacts }
}

describe('artifact public permission action', () => {
	test('optimistically aligns permission fields and confirms the server transaction', async () => {
		const confirmArtifact = vi.fn(async () => {})
		const update = vi.fn<SharingApi['sharing']['artifact']['update']>(async () => ({
			transactionId: 'tx-1',
			shareKey: 'server-key',
			permission: 'view',
		}))
		const artifacts = testCollection<ArtifactMetadata>()
		artifacts.insert(makeArtifact())
		const actions = createSharingActions(
			testCollection<TaskOrganizationAcl>(),
			testCollection<TaskUserAcl>(),
			testCollection<Task>(),
			artifacts,
			{
				sharing: {
					organization: { update: vi.fn<SharingApi['sharing']['organization']['update']>() },
					user: { update: vi.fn<SharingApi['sharing']['user']['update']>() },
					artifact: { update },
				},
			},
			'user-1',
			'org-1',
			async () => {},
			async () => {},
			confirmArtifact,
		)

		const transaction = actions.updateArtifactSharing({ artifactId: 'artifact-1', permission: 'view' })
		expect(artifacts.state.get('artifact-1')).toMatchObject({ public_permission: 'view', share_enabled: true })
		await transaction.isPersisted.promise

		expect(update).toHaveBeenCalledWith({ artifactId: 'artifact-1', permission: 'view' })
		expect(confirmArtifact).toHaveBeenCalledWith('tx-1')
	})

	test('rolls the optimistic permission back when persistence fails', async () => {
		const update = vi.fn<SharingApi['sharing']['artifact']['update']>(async () => {
			throw new Error('backend unavailable')
		})
		const { actions, artifacts } = makeActions(update)

		const transaction = actions.updateArtifactSharing({ artifactId: 'artifact-1', permission: 'view' })
		expect(artifacts.state.get('artifact-1')).toMatchObject({ public_permission: 'view', share_enabled: true })
		await expect(transaction.isPersisted.promise).rejects.toThrow('backend unavailable')
		expect(artifacts.state.get('artifact-1')).toMatchObject({ public_permission: 'off', share_enabled: false })
	})
})
