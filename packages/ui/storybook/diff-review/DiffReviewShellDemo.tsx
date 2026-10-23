import { useState } from 'react'

import { DiffViewer } from '../../src/components/conversation-stream/diff-viewer'
import { DiffFileTree } from '../../src/components/diff-review/DiffFileTree'
import { diffReviewFiles } from './fixtures'

export function DiffReviewShellDemo() {
	const [selectedPath, setSelectedPath] = useState<string | null>(diffReviewFiles[0]?.path ?? null)
	const selected = diffReviewFiles.find((file) => file.path === selectedPath) ?? null

	return (
		<div className="flex h-[560px] border border-border">
			<div className="w-[300px] shrink-0 border-r border-border">
				<DiffFileTree
					files={diffReviewFiles.map((file) => ({ path: file.path, status: file.status }))}
					onSelectFile={setSelectedPath}
				/>
			</div>
			<div className="min-w-0 flex-1 overflow-auto">
				{selected ? (
					<div>
						<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[13px]">
							<span>{selected.path}</span>
							<span className="whitespace-nowrap">
								<span className="text-green-500">+{selected.additions}</span>{' '}
								<span className="text-red-500">-{selected.deletions}</span>
							</span>
						</div>
						<DiffViewer
							fileName={selected.path}
							oldContent={selected.oldContent}
							newContent={selected.newContent}
							mode="unified"
						/>
					</div>
				) : (
					<div className="p-6 text-[13px] text-muted-foreground">
						Select a file in the tree to review its diff.
					</div>
				)}
			</div>
		</div>
	)
}
