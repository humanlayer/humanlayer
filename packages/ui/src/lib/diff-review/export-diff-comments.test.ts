import { describe, expect, test } from 'vitest'

import { exportDiffComments, getTruncatedDiffCommentId } from './export-diff-comments'
import type { ProjectableDiffComment, ProjectedDiffThread } from './project-diff-comments'

function comment(overrides: Partial<ProjectableDiffComment> = {}): ProjectableDiffComment {
	return {
		id: '00000000-0000-7000-8000-abcdef123456',
		organization_id: '00000000-0000-7000-8000-000000000010',
		resource_owner_user_id: 'user-1',
		task_id: '00000000-0000-7000-8000-000000000020',
		created_by_user_id: 'user-1',
		reply_to_comment_id: null,
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Check x < y & keep it.',
		content_json: null,
		anchor_json: {
			v: 1,
			repoId: 'syncopate & tools',
			path: 'src/"config".ts',
			patchHash: 'patch-1',
			start: { side: 'old', line: 42 },
			end: { side: 'new', line: 56 },
		},
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		author: { firstName: 'Kyle', email: 'kyle@example.com' },
		...overrides,
	}
}

function thread(overrides: Partial<ProjectedDiffThread> = {}): ProjectedDiffThread {
	return {
		root: comment(),
		replies: [],
		placement: { status: 'current', fileId: 'file-1', side: 'new', line: 56 },
		...overrides,
	}
}

describe('exportDiffComments', () => {
	test('exports exact open roots with escaped attributes, text, and short IDs', () => {
		const reply = comment({
			id: '00000000-0000-7000-8000-000000000002',
			reply_to_comment_id: comment().id,
			anchor_json: null,
			created_at: 2n,
			content_text: 'I fixed > one path.',
			created_by_agent: true,
			author: { firstName: 'Dexter', email: 'dexter@example.com' },
		})
		const result = exportDiffComments([thread({ replies: [reply] })])

		expect(result.rootCommentIds).toEqual(['00000000-0000-7000-8000-abcdef123456'])
		expect(result.xml).toBe(`<diff_comments>
  <diff_comment id="abcdef123456" repo="syncopate &amp; tools" path="src/&quot;config&quot;.ts" start_line="42" end_line="56" state="current">
    Kyle: Check x &lt; y &amp; keep it.
    Dexter&apos;s agent: I fixed &gt; one path.
  </diff_comment>
</diff_comments>`)
	})

	test('marks outdated threads, retains tombstones, and excludes resolved or deleted roots', () => {
		const deletedReply = comment({
			id: '00000000-0000-7000-8000-000000000003',
			reply_to_comment_id: comment().id,
			anchor_json: null,
			created_at: 3n,
			content_text: 'secret deleted text',
			is_deleted: true,
		})
		const outdated = thread({
			replies: [deletedReply],
			placement: { status: 'outdated-file', fileId: 'file-1' },
		})
		const resolved = thread({ root: comment({ id: 'resolved', is_resolved: true }) })
		const deleted = thread({ root: comment({ id: 'deleted', is_deleted: true }) })

		const result = exportDiffComments([outdated, resolved, deleted])

		expect(result.rootCommentIds).toEqual([outdated.root.id])
		expect(result.xml).toContain('state="outdated; file has changed since comment was left"')
		expect(result.xml).toContain('Kyle: Comment deleted')
		expect(result.xml).not.toContain('secret deleted text')
		expect(result.xml).toContain('read the current file before acting')
	})

	test('includes the selected diff the reviewer commented on, escaped', () => {
		const root = comment({
			anchor_json: {
				...comment().anchor_json!,
				selectedDiff: '  line 19\n- line 20: a < b\n+ line 20: cherry',
			},
		})
		const result = exportDiffComments([thread({ root })])

		expect(result.xml).toBe(`<diff_comments>
  <diff_comment id="abcdef123456" repo="syncopate &amp; tools" path="src/&quot;config&quot;.ts" start_line="42" end_line="56" state="current">
    <selected_diff>
  line 19
- line 20: a &lt; b
+ line 20: cherry
    </selected_diff>
    Kyle: Check x &lt; y &amp; keep it.
  </diff_comment>
</diff_comments>`)
	})

	test('uses the rightmost twelve UUID characters and emits an empty wrapper', () => {
		expect(getTruncatedDiffCommentId('12345678-1234-1234-1234-abcdef123456')).toBe('abcdef123456')
		expect(exportDiffComments([])).toEqual({ xml: '<diff_comments></diff_comments>', rootCommentIds: [] })
	})
})
