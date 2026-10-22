import type { ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Link, LockKeyhole, Users } from 'lucide-react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'

interface ArtifactSharingDialogProps {
	open: boolean
	fileName: string
	organizationName: string
	permission: ArtifactPublicPermission
	canEditPermission: boolean
	publicSharingEnabled: boolean
	isPending: boolean
	canCopy: boolean
	onOpenChange: (open: boolean) => void
	onPermissionChange: (permission: ArtifactPublicPermission) => void
	onCopyLink: () => void
}

export function ArtifactSharingDialog({
	open,
	fileName,
	organizationName,
	permission,
	canEditPermission,
	publicSharingEnabled,
	isPending,
	canCopy,
	onOpenChange,
	onPermissionChange,
	onCopyLink,
}: ArtifactSharingDialogProps) {
	const permissionControlDisabled = !canEditPermission || !publicSharingEnabled || isPending
	const copyShortcut = hotkeysCatalog.global.shortcuts.copyPrimaryUrl
	const closeShortcut = hotkeysCatalog.global.shortcuts.unfocusOrBack
	const publicDescription =
		permission === 'off'
			? "People without task access can't open the artifact"
			: permission === 'comment'
				? 'Anyone with the link can view and comment without signing in'
				: 'Anyone with the link can view the artifact without signing in'

	useHotkeys(
		copyShortcut.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (canCopy && !isPending) onCopyLink()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.ARTIFACT_SHARING_DIALOG],
		},
		[open, canCopy, isPending, onCopyLink],
	)

	useHotkeys(
		closeShortcut.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			onOpenChange(false)
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.ARTIFACT_SHARING_DIALOG],
		},
		[open, onOpenChange],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.ARTIFACT_SHARING_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="ArtifactSharingDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-2xl" onEscapeKeyDown={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>Share artifact</DialogTitle>
						<DialogDescription className="truncate">{fileName}</DialogDescription>
					</DialogHeader>

					<div className="space-y-3">
						<div className="text-xs font-medium text-muted-foreground">General access</div>
						<div className="divide-y border">
							<div className="grid min-h-20 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 p-3">
								<div className="grid size-8 place-items-center border text-primary">
									<Users className="size-4" aria-hidden="true" />
								</div>
								<div>
									<div className="text-sm font-medium">People in {organizationName}</div>
									<div className="text-xs text-muted-foreground">Members who can open this task</div>
								</div>
								<div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
									<LockKeyhole className="size-3.5" aria-hidden="true" />
									Can comment
								</div>
							</div>

							<div className="grid min-h-20 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 p-3">
								<div className="grid size-8 place-items-center border text-primary">
									<Link className="size-4" aria-hidden="true" />
								</div>
								<div>
									<div className="text-sm font-medium">Anyone with the link</div>
									<div className="text-xs text-muted-foreground">{publicDescription}</div>
									{!publicSharingEnabled ? (
										<div className="mt-1 text-xs text-muted-foreground">
											Your organization has turned this off.
										</div>
									) : null}
								</div>
								<Select
									value={permission}
									disabled={permissionControlDisabled}
									onValueChange={(value) => onPermissionChange(value as ArtifactPublicPermission)}
								>
									<SelectTrigger className="w-36" aria-label="Choose public link permission">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="off">No access</SelectItem>
										<SelectItem value="view">Can view</SelectItem>
										<SelectItem value="comment">Can comment</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>

					<DialogFooter className="sm:justify-between">
						<Button variant="outline" onClick={onCopyLink} disabled={!canCopy || isPending}>
							Copy link
							<span aria-hidden="true">
								<KeyboardShortcut size="xs" className="ml-1">
									{formatShortcut(copyShortcut.display)}
								</KeyboardShortcut>
							</span>
						</Button>
						<Button variant="secondary" onClick={() => onOpenChange(false)}>
							Done
							<span aria-hidden="true">
								<KeyboardShortcut size="xs" className="ml-1">
									Esc
								</KeyboardShortcut>
							</span>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
