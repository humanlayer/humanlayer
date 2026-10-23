import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useRiptideApi } from '@/orpc/client'

import { type RepositoryDraft, RepositorySetupForm, repositoryRecipe } from './RepositorySetupForm'

type Project = RiptideApiOutputs['projects']['v2']['list']['projects'][number]

function preventOutsidePointerDown(event: Event) {
	event.preventDefault()
}

export function RepositorySetupDialog({
	project,
	identity,
	onClose,
	onSaved,
}: {
	project: Project
	identity: string
	onClose: () => void
	onSaved: () => Promise<void>
}) {
	const { user } = useAuth()
	const { queryClient: api } = useRiptideApi()
	const mutation = useMutation(api.projects.v2.update.mutationOptions())
	const [busy, setBusy] = useState(false)
	const repo = project.repositories.find((entry) => entry.repositoryIdentity === identity)
	// Match the form's mount-time baseline, not subsequent project refreshes.
	const [initialRepo] = useState(repo)
	const canEdit = user?.id === project.resourceOwnerUserId
	if (!repo || !initialRepo) return null

	const initialDraft: RepositoryDraft = {
		...initialRepo,
		path: null,
		remotes: [],
		copyGlobsText: initialRepo.copyGlobs.join('\n'),
		setupCommand: initialRepo.setupCommand ?? '',
	}

	const handleOpenChange = (open: boolean) => {
		if (!open && !busy) onClose()
	}

	const handleSave = async (draft: RepositoryDraft) => {
		if (!canEdit) throw new Error('Only the owner can edit this project')

		const edited = repositoryRecipe(draft)
		const changes: Partial<(typeof project.repositories)[number]> = {}
		if (draft.remoteUrl !== initialRepo.remoteUrl) changes.remoteUrl = edited.remoteUrl
		if (draft.defaultBranch !== initialRepo.defaultBranch) changes.defaultBranch = edited.defaultBranch
		if (draft.default !== initialRepo.default) changes.default = edited.default
		if (draft.autoPushBranch !== initialRepo.autoPushBranch) changes.autoPushBranch = edited.autoPushBranch
		if (draft.copyGlobsText !== initialRepo.copyGlobs.join('\n')) changes.copyGlobs = edited.copyGlobs
		if (draft.setupCommand !== (initialRepo.setupCommand ?? '')) changes.setupCommand = edited.setupCommand

		const repositories = project.repositories.map((entry) => {
			if (entry.repositoryIdentity === identity) return { ...entry, ...changes }
			if (changes.default) return { ...entry, default: false }
			return entry
		})

		await mutation.mutateAsync({ projectId: project.id, repositories })
		try {
			await onSaved()
		} catch {
			toast.warning('Repository saved, but the project list could not refresh')
		}
		onClose()
	}

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.PROJECT_EDIT_DIALOG}
			rootScopeDisabled
			componentName="RepositorySetupDialog"
		>
			<Dialog open onOpenChange={handleOpenChange}>
				<DialogContent
					className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
					showCloseButton={!busy}
					onPointerDownOutside={preventOutsidePointerDown}
				>
					<DialogHeader className="shrink-0 border-b p-6 pr-12">
						<DialogTitle>Repository setup</DialogTitle>
						<DialogDescription className="break-all">{identity} · Shared project recipe</DialogDescription>
					</DialogHeader>
					<RepositorySetupForm
						initial={initialDraft}
						disabled={!canEdit}
						hotkeyScope={HOTKEY_SCOPES.PROJECT_EDIT_DIALOG}
						onBusyChange={setBusy}
						onCancel={onClose}
						onSave={handleSave}
					/>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
