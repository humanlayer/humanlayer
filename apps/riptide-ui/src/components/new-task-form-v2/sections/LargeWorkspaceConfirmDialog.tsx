/**
 * LargeWorkspaceConfirmDialog.tsx
 *
 * Dialog component for confirming creation of multiple worktrees.
 */

import { Button } from '@humanlayer/ui/components/button'
import type { FC } from 'react'

export interface LargeWorkspaceConfirmDialogProps {
	open: boolean
	repoCount: number
	onAllowThisTime: () => void
	onAlwaysAllow: () => void
	onCancel: () => void
}

export const LargeWorkspaceConfirmDialog: FC<LargeWorkspaceConfirmDialogProps> = ({
	open,
	repoCount,
	onAllowThisTime,
	onAlwaysAllow,
	onCancel,
}) => {
	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="bg-background rounded-lg border shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
				<div className="space-y-2">
					<h3 className="text-base font-semibold">Create {repoCount} worktrees?</h3>
					<p className="text-sm text-muted-foreground">
						This workspace config has {repoCount} repos. Creating worktrees for all of them may take a
						moment. Consider using <strong>Later</strong> to defer repo selection until after planning.
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<Button onClick={onAlwaysAllow} className="w-full" size="sm">
						Always allow
					</Button>
					<Button onClick={onAllowThisTime} variant="outline" className="w-full" size="sm">
						Allow this time
					</Button>
					<Button onClick={onCancel} variant="ghost" className="w-full" size="sm">
						Cancel
					</Button>
				</div>
			</div>
		</div>
	)
}
