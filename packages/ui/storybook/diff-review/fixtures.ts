import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import type { GitStatus } from '@pierre/trees'

import type { ProjectableDiffComment, ProjectedDiffThread } from '../../src/lib/diff-review/project-diff-comments'

export interface DiffReviewFile {
	path: string
	status: GitStatus
	oldContent: string
	newContent: string
	additions: number
	deletions: number
	commentCount?: number
}

export const diffReviewFiles: DiffReviewFile[] = [
	{
		path: 'riptide-api/src/routes/get.ts',
		status: 'added',
		additions: 14,
		deletions: 0,
		oldContent: '',
		newContent: `import { os } from '@orpc/server'
import { z } from 'zod'
import { db } from '../db'

export const getSession = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    const session = await db.sessions.findById(input.id)
    if (!session) {
      throw new Error('session not found')
    }
    return session
  })
`,
	},
	{
		path: 'riptide-api/src/routes/list.ts',
		status: 'modified',
		additions: 5,
		deletions: 2,
		oldContent: `import { os } from '@orpc/server'
import { db } from '../db'

export const listSessions = os.handler(async () => {
  const sessions = await db.sessions.findAll()
  return sessions
})
`,
		newContent: `import { os } from '@orpc/server'
import { z } from 'zod'
import { db } from '../db'

export const listSessions = os
  .input(z.object({ taskId: z.string() }))
  .handler(async ({ input }) => {
    const sessions = await db.sessions.findByTask(input.taskId)
    return sessions.sort((a, b) => b.createdAt - a.createdAt)
  })
`,
	},
	{
		path: 'riptide-api/src/legacy/old-handler.ts',
		status: 'deleted',
		additions: 0,
		deletions: 6,
		oldContent: `// Deprecated: replaced by src/routes/list.ts
export function oldHandler(req, res) {
  const sessions = fetchSessions()
  res.json(sessions)
}
`,
		newContent: '',
	},
	{
		path: 'riptide-ui/src/components/DiffModal.tsx',
		status: 'modified',
		additions: 9,
		deletions: 3,
		commentCount: 3,
		oldContent: `import { useState } from 'react'

export function DiffModal({ files }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <FileList files={files} />
    </Dialog>
  )
}
`,
		newContent: `import { useMemo, useState } from 'react'
import { DiffFileTree } from './DiffFileTree'

export function DiffModal({ files }) {
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => files.sort(byPath), [files])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DiffFileTree files={sorted} />
    </Dialog>
  )
}
`,
	},
	{
		path: 'riptide-ui/src/lib/format.ts',
		status: 'modified',
		additions: 3,
		deletions: 1,
		oldContent: `export function formatDate(date: Date): string {
  return date.toISOString()
}
`,
		newContent: `export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
`,
	},
]

export function diffComment(id: string, overrides: Partial<DiffComment> = {}): ProjectableDiffComment {
	return {
		id,
		organization_id: '00000000-0000-7000-8000-000000000010',
		resource_owner_user_id: 'reviewer-1',
		task_id: '00000000-0000-7000-8000-000000000020',
		created_by_user_id: 'reviewer-1',
		reply_to_comment_id: null,
		created_at: 1_753_200_000_000n,
		updated_at: 1_753_200_000_000n,
		content_text: 'Could we add a test for the **retry path** before this ships?',
		content_json: null,
		anchor_json: {
			v: 1,
			repoId: 'syncopate',
			path: 'riptide-api/src/routes/get.ts',
			patchHash: 'patch-1',
			start: { side: 'old', line: 8 },
			end: { side: 'new', line: 12 },
		},
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		author: { email: 'kyle@example.com', firstName: 'Kyle', lastName: 'Mistele' },
		...overrides,
	}
}

const root = diffComment('00000000-0000-7000-8000-000000000001')
const reply = diffComment('00000000-0000-7000-8000-000000000002', {
	reply_to_comment_id: root.id,
	anchor_json: null,
	created_at: 1_753_200_060_000n,
	content_text: 'Added coverage for both retry outcomes.',
	created_by_agent: true,
})

export const currentDiffCommentThread: ProjectedDiffThread = {
	root,
	replies: [reply],
	placement: { status: 'current', fileId: 'file-1', side: 'new', line: 12 },
}

export const resolvedDiffCommentThread: ProjectedDiffThread = {
	root: diffComment('00000000-0000-7000-8000-000000000003', { is_resolved: true }),
	replies: [],
	placement: { status: 'current', fileId: 'file-1', side: 'new', line: 12 },
}

export const deletedDiffCommentThread: ProjectedDiffThread = {
	root: diffComment('00000000-0000-7000-8000-000000000004', { is_deleted: true }),
	replies: [reply],
	placement: { status: 'outdated-inline', fileId: 'file-1', side: 'new', line: 12 },
}

export const outdatedDiffCommentThread: ProjectedDiffThread = {
	root: diffComment('00000000-0000-7000-8000-000000000005'),
	replies: [],
	placement: { status: 'outdated-file', fileId: 'file-1' },
}

const rootAnchor = root.anchor_json
if (!rootAnchor) throw new Error('root diff comment fixture must have an anchor')

export const renamedDiffCommentThread: ProjectedDiffThread = {
	root: diffComment('00000000-0000-7000-8000-000000000006', {
		anchor_json: { ...rootAnchor, path: 'riptide-api/src/routes/old-get.ts' },
	}),
	replies: [],
	placement: { status: 'outdated-inline', fileId: 'file-renamed', side: 'new', line: 12 },
}

export const missingDiffCommentThread: ProjectedDiffThread = {
	root: diffComment('00000000-0000-7000-8000-000000000007', {
		anchor_json: { ...rootAnchor, path: 'riptide-api/src/removed.ts' },
	}),
	replies: [],
	placement: { status: 'file-missing', repoId: 'syncopate', path: 'riptide-api/src/removed.ts' },
}
