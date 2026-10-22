import { useState } from 'react'

import { Button } from '../../src/components/button'
import { Card } from '../../src/components/card'
import type { CodeViewStackComparison, CodeViewStackFile } from '../../src/components/diff-review/code-view-stack'
import { CodeViewStack } from '../../src/components/diff-review/code-view-stack'
import { DiffHeaderBar } from '../../src/components/diff-review/diff-header-bar'
import type { DiffStyle } from '../../src/components/diff-style-provider'

const files: CodeViewStackFile[] = [
	{
		id: 'fullscreen-demo',
		repoId: 'riptide-ui',
		path: 'src/components/diffs/DiffFullscreenReview.tsx',
		changeType: 'modified',
		additions: 8,
		deletions: 1,
		binary: false,
		generated: false,
		versionId: 'fullscreen-demo:new',
	},
]

const comparisons: CodeViewStackComparison[] = [
	{
		fileId: 'fullscreen-demo',
		oldFile: {
			name: 'src/components/diffs/DiffFullscreenReview.tsx',
			contents: 'export function DiffReview() {\n  return <TaskDiffReviewContent />\n}\n',
			cacheKey: 'fullscreen-demo:old',
		},
		newFile: {
			name: 'src/components/diffs/DiffFullscreenReview.tsx',
			contents:
				'export function DiffReview() {\n  return (\n    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.DIFF_FULLSCREEN}>\n      <div role="dialog" aria-modal="true">\n        <TaskDiffReviewContent />\n      </div>\n    </HotkeyScopeBoundary>\n  )\n}\n',
			cacheKey: 'fullscreen-demo:new',
		},
	},
]

export function DiffFullscreenShellDemo() {
	const [open, setOpen] = useState(true)
	const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified')
	const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set())
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
	const [hideReviewed, setHideReviewed] = useState(false)
	const visibleFiles = hideReviewed ? files.filter((file) => !reviewedIds.has(file.id)) : files

	return (
		<div className="relative min-h-screen bg-background p-6">
			<Card className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
				<p className="font-mono text-sm text-muted-foreground">
					The task page remains mounted while fullscreen review is active.
				</p>
				<Button className="w-fit" onClick={() => setOpen(true)}>
					Open fullscreen diff
				</Button>
			</Card>

			{open && (
				<div className="fixed inset-0 z-10 flex min-h-0 min-w-0 bg-background p-3">
					<Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0! overflow-hidden">
						<DiffHeaderBar
							diffStyle={diffStyle}
							onDiffStyleChange={setDiffStyle}
							reviewedCount={reviewedIds.size}
							totalCount={files.length}
							collapsedCount={collapsedIds.size}
							reviewedLines={reviewedIds.size === 0 ? 0 : 9}
							totalLines={9}
							hideReviewed={hideReviewed}
							onHideReviewedChange={setHideReviewed}
							reviewActions={{
								markAllReviewed: () => {
									setReviewedIds(new Set(files.map((file) => file.id)))
									setCollapsedIds(new Set(files.map((file) => file.id)))
								},
								markAllUnreviewed: () => {
									setReviewedIds(new Set())
									setCollapsedIds(new Set())
								},
								collapseAll: () => setCollapsedIds(new Set(files.map((file) => file.id))),
								expandAll: () => setCollapsedIds(new Set()),
								resetReview: () => {
									setReviewedIds(new Set())
									setCollapsedIds(new Set())
								},
							}}
							isFullscreen
							onFullscreenToggle={() => setOpen(false)}
							onClose={() => setOpen(false)}
						/>
						<CodeViewStack
							files={visibleFiles}
							comparisons={comparisons}
							diffStyle={diffStyle}
							reviewedIds={reviewedIds}
							collapsedIds={collapsedIds}
							onReviewedChange={(file, reviewed) =>
								setReviewedIds((current) => updateSet(current, file.id, reviewed))
							}
							onCollapsedChange={(file, collapsed) =>
								setCollapsedIds((current) => updateSet(current, file.id, collapsed))
							}
						/>
					</Card>
				</div>
			)}
		</div>
	)
}

function updateSet(current: ReadonlySet<string>, value: string, included: boolean) {
	const next = new Set(current)
	if (included) next.add(value)
	else next.delete(value)
	return next
}
