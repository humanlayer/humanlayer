import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'

/** Builds a user-authored, unanchored artifact comment row for tests. */
export function commentRow(id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return {
		id,
		organization_id: 'org',
		resource_owner_user_id: 'owner',
		task_id: 'task',
		...userAuthoredCommentColumns('user-1'),
		reply_to_comment_id: null,
		created_at: 100n,
		updated_at: 100n,
		content_text: id,
		content_json: null,
		artifact_id: 'artifact',
		created_at_artifact_version_id: null,
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		anchor_json: null,
		kind: 'comment',
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}
