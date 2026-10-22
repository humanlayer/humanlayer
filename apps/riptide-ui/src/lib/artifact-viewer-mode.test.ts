import { describe, expect, test } from 'vitest'

import { resolveArtifactViewerMode } from './artifact-viewer-mode'

describe('resolveArtifactViewerMode', () => {
	test.each([
		'notes.txt',
		'data.json',
		'events.jsonl',
		'preview.html',
		'image.png',
		'document.pdf',
		'component.tsx',
		'',
	])('routes %s through the generic renderer regardless of context or override', (fileName) => {
		expect(
			resolveArtifactViewerMode({
				artifactId: 'artifact-1',
				fileName,
				forceLegacyViewer: true,
				commentContext: {
					taskId: 'task-1',
					resourceOwnerUserId: 'owner-1',
					organizationId: 'org-1',
					userId: 'user-1',
				},
			}),
		).toEqual({
			kind: 'generic',
			reviewHotkeys: false,
			canSwitchVersion: false,
			commentDeliveryOwner: 'none',
		})
	})

	test.each(
		[false, true].flatMap((forceLegacyViewer) =>
			[false, true].flatMap((hasArtifact) =>
				[false, true].flatMap((hasTask) =>
					[false, true].flatMap((hasOwner) =>
						[false, true].flatMap((hasOrganization) =>
							[false, true].map((hasUser) => ({
								forceLegacyViewer,
								hasArtifact,
								hasTask,
								hasOwner,
								hasOrganization,
								hasUser,
							})),
						),
					),
				),
			),
		),
	)(
		'classifies Markdown with legacy=$forceLegacyViewer artifact=$hasArtifact task=$hasTask owner=$hasOwner org=$hasOrganization user=$hasUser',
		({ forceLegacyViewer, hasArtifact, hasTask, hasOwner, hasOrganization, hasUser }) => {
			const hasCommentContext = hasArtifact && hasTask && hasOwner && hasOrganization && hasUser
			const mode = resolveArtifactViewerMode({
				artifactId: hasArtifact ? 'artifact-1' : null,
				fileName: 'review.md',
				forceLegacyViewer,
				commentContext: {
					taskId: hasTask ? 'task-1' : null,
					resourceOwnerUserId: hasOwner ? 'owner-1' : null,
					organizationId: hasOrganization ? 'org-1' : null,
					userId: hasUser ? 'user-1' : null,
				},
			})

			expect(mode).toEqual(
				forceLegacyViewer
					? {
							kind: 'legacy',
							reviewHotkeys: false,
							canSwitchVersion: hasArtifact,
							commentDeliveryOwner: hasCommentContext ? 'legacy' : 'none',
						}
					: hasCommentContext
						? {
								kind: 'review',
								reviewHotkeys: true,
								canSwitchVersion: true,
								commentDeliveryOwner: 'review',
							}
						: {
								kind: 'review-readonly',
								reviewHotkeys: false,
								canSwitchVersion: hasArtifact,
								commentDeliveryOwner: 'none',
							},
			)
		},
	)

	test('treats MDX as Markdown review content', () => {
		expect(
			resolveArtifactViewerMode({
				artifactId: 'artifact-1',
				fileName: 'review.mdx',
				forceLegacyViewer: false,
				commentContext: {
					taskId: 'task-1',
					resourceOwnerUserId: 'owner-1',
					organizationId: 'org-1',
					userId: 'user-1',
				},
			}),
		).toMatchObject({ kind: 'review', commentDeliveryOwner: 'review' })
	})
})
