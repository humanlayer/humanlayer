import { beforeEach, describe, expect, test, vi } from 'vitest'

import { capturePostHogEvent } from '@/integrations/posthog/posthog'

import {
	trackArtifactPublicAccessChanged,
	trackArtifactShareLinkCopied,
	trackArtifactSharingDialogOpened,
} from './artifact-sharing-analytics'

vi.mock('@/integrations/posthog/posthog', () => ({ capturePostHogEvent: vi.fn() }))

describe('artifact sharing analytics', () => {
	beforeEach(() => vi.mocked(capturePostHogEvent).mockReset())

	test('records dialog opens without capability data', () => {
		trackArtifactSharingDialogOpened({
			artifactId: 'artifact-1',
			source: 'artifact-sidebar',
			publicPermission: 'view',
		})

		expect(capturePostHogEvent).toHaveBeenCalledWith('artifact_sharing_dialog_opened', {
			artifact_id: 'artifact-1',
			source: 'artifact-sidebar',
			public_permission: 'view',
		})
	})

	test('records committed permission changes', () => {
		trackArtifactPublicAccessChanged({
			artifactId: 'artifact-1',
			previousPermission: 'off',
			newPermission: 'view',
			actorRelationship: 'task_editor',
		})

		expect(capturePostHogEvent).toHaveBeenCalledWith('artifact_public_access_changed', {
			artifact_id: 'artifact-1',
			previous_permission: 'off',
			new_permission: 'view',
			actor_relationship: 'task_editor',
		})
	})

	test('records successful link copies without the share key', () => {
		trackArtifactShareLinkCopied({
			artifactId: 'artifact-1',
			source: 'artifact-fullscreen',
			linkType: 'public',
			publicPermission: 'view',
		})

		expect(capturePostHogEvent).toHaveBeenCalledWith('artifact_share_link_copied', {
			artifact_id: 'artifact-1',
			source: 'artifact-fullscreen',
			link_type: 'public',
			public_permission: 'view',
		})
	})
})
