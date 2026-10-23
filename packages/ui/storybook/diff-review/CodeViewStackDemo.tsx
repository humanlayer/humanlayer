import { useMemo, useState } from 'react'

import type { CodeViewStackComparison, CodeViewStackFile } from '../../src/components/diff-review/code-view-stack'
import { CodeViewStack } from '../../src/components/diff-review/code-view-stack'
import type { DiffCommentDeliveryMode } from '../../src/components/diff-review/diff-comment-thread'
import type { DiffStyle } from '../../src/components/diff-style-provider'
import { projectDiffComments, type ProjectableDiffComment } from '../../src/lib/diff-review/project-diff-comments'
import { diffComment } from './fixtures'

// A long file with one change in the middle, so the unchanged-section controls can reveal the rest.
const alphaLines = Array.from({ length: 60 }, (_, index) => `export const line${index + 1} = ${index + 1}`)
const alphaOld = `${alphaLines.join('\n')}\n`
const alphaNew = `${alphaLines.map((line, index) => (index === 29 ? 'export const line30 = 300\nexport const beta = 3' : line)).join('\n')}\n`

const comparisons: CodeViewStackComparison[] = [
	{
		fileId: 'alpha',
		oldFile: { name: 'src/alpha.ts', contents: alphaOld, cacheKey: 'alpha:old' },
		newFile: { name: 'src/alpha.ts', contents: alphaNew, cacheKey: 'alpha:new' },
	},
	{
		fileId: 'bravo',
		oldFile: {
			name: 'src/bravo.ts',
			contents: 'export const old = true\nexport const stale = true\n',
			cacheKey: 'bravo:old',
		},
		newFile: { name: 'src/bravo.ts', contents: 'export const current = true\n', cacheKey: 'bravo:new' },
	},
]

const files: CodeViewStackFile[] = [
	{
		id: 'alpha',
		repoId: 'riptide-ui',
		path: 'src/alpha.ts',
		changeType: 'modified',
		additions: 2,
		deletions: 1,
		binary: false,
		generated: false,
		versionId: 'alpha:new',
	},
	{
		id: 'bravo',
		repoId: 'riptide-api',
		path: 'src/bravo.ts',
		changeType: 'modified',
		additions: 1,
		deletions: 2,
		binary: false,
		generated: false,
		versionId: 'bravo:new',
	},
]

function lineComment(
	id: string,
	file: CodeViewStackFile,
	side: 'old' | 'new',
	line: number,
	contentText: string,
): ProjectableDiffComment {
	return {
		...diffComment(id, {
			content_text: contentText,
			anchor_json: {
				v: 1,
				repoId: file.repoId,
				path: file.path,
				patchHash: file.versionId ?? '',
				start: { side, line },
				end: { side, line },
			},
		}),
		// A long name shows how the card header truncates in a narrow column.
		author: { email: 'kyle@example.com', firstName: 'Kyle Login for Agent', lastName: 'Mistele' },
	}
}

const [alphaFile, bravoFile] = files
if (!alphaFile || !bravoFile) throw new Error('CodeViewStackDemo requires two fixture files')

// Split view widens a card across both columns unless the other side of its row
// also has one: alpha's cards span, bravo's old/new line 1 pair share a row.
const comments: ProjectableDiffComment[] = [
	lineComment('00000000-0000-7000-8000-000000000101', alphaFile, 'old', 30, 'Why drop the old value?'),
	diffComment('00000000-0000-7000-8000-000000000102', {
		reply_to_comment_id: '00000000-0000-7000-8000-000000000101',
		anchor_json: null,
		content_text: 'The new value matches the config default.',
		created_by_agent: true,
	}),
	lineComment('00000000-0000-7000-8000-000000000103', alphaFile, 'new', 31, 'Name this after what it counts.'),
	lineComment('00000000-0000-7000-8000-000000000104', bravoFile, 'old', 1, 'Callers still read `old`.'),
	lineComment('00000000-0000-7000-8000-000000000105', bravoFile, 'new', 1, 'Export a type for this too.'),
]

export function CodeViewStackDemo({
	initiallyCollapsed = false,
	initiallyReviewed = false,
	generated = false,
	placeholder,
	diffStyle = 'unified',
	withComments = false,
}: {
	initiallyCollapsed?: boolean
	initiallyReviewed?: boolean
	generated?: boolean
	placeholder?: 'binary' | 'pending'
	diffStyle?: DiffStyle
	withComments?: boolean
}) {
	const [deliveryMode, setDeliveryMode] = useState<DiffCommentDeliveryMode>('send-and-resolve')
	const projectedComments = useMemo(
		() => (withComments ? projectDiffComments({ comments, files, comparisons }) : undefined),
		[withComments],
	)
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
		initiallyCollapsed || initiallyReviewed || generated ? new Set(['alpha']) : new Set(),
	)
	const [reviewedIds, setReviewedIds] = useState<Set<string>>(() =>
		initiallyReviewed ? new Set(['alpha']) : new Set(),
	)
	const [firstFile] = files
	if (!firstFile) throw new Error('CodeViewStackDemo requires at least one fixture file')
	const demoFiles = placeholder
		? [
				{
					...firstFile,
					id: placeholder,
					path: `assets/${placeholder}.dat`,
					binary: placeholder === 'binary',
					versionId: placeholder === 'pending' ? 'pending' : undefined,
				},
			]
		: generated
			? [{ ...firstFile, generated: true }]
			: files
	return (
		<div className="flex h-screen flex-col">
			<CodeViewStack
				files={demoFiles}
				comparisons={comparisons}
				diffStyle={diffStyle}
				comments={projectedComments}
				taskId={withComments ? '00000000-0000-7000-8000-000000000020' : undefined}
				deliveryMode={deliveryMode}
				onDeliveryModeChange={setDeliveryMode}
				onReplyComment={async () => true}
				onResolveComment={() => {}}
				onDeliverThread={() => {}}
				reviewedIds={reviewedIds}
				collapsedIds={collapsedIds}
				onReviewedChange={(file, reviewed) =>
					setReviewedIds((current) => updateSet(current, file.id, reviewed))
				}
				onCollapsedChange={(file, collapsed) =>
					setCollapsedIds((current) => updateSet(current, file.id, collapsed))
				}
			/>
		</div>
	)
}

function updateSet(current: ReadonlySet<string>, value: string, included: boolean) {
	const next = new Set(current)
	if (included) next.add(value)
	else next.delete(value)
	return next
}
