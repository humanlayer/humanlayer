import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { Field, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useRiptideApi } from '@/orpc/client'

type Project = RiptideApiOutputs['projects']['v2']['list']['projects'][number]

export function ProjectEditDialog({
	project,
	onClose,
	onSaved,
}: {
	readonly project: Project
	readonly onClose: () => void
	readonly onSaved: () => Promise<void>
}) {
	const { queryClient: api } = useRiptideApi()
	const updateMutation = useMutation(api.projects.v2.update.mutationOptions())
	const [name, setName] = useState(project.name)
	const [description, setDescription] = useState(project.description ?? '')
	const [visibleToOrganization, setVisibleToOrganization] = useState(!project.private)

	const canSave = !updateMutation.isPending && name.trim().length > 0

	const save = useCallback(async () => {
		if (updateMutation.isPending || !name.trim()) return
		try {
			await updateMutation.mutateAsync({
				projectId: project.id,
				name: name.trim(),
				description: description.trim() || null,
				private: !visibleToOrganization,
			})
			await onSaved()
			onClose()
			toast.success('Project updated')
		} catch {
			toast.error('Failed to update project')
		}
	}, [updateMutation, project.id, name, description, visibleToOrganization, onSaved, onClose])

	const handleCancel = useCallback(() => {
		onClose()
	}, [onClose])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			void save()
		},
		{
			enabled: canSave,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.PROJECT_EDIT_DIALOG],
		},
		[canSave, save],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{
			enabled: !updateMutation.isPending,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.PROJECT_EDIT_DIALOG],
		},
		[updateMutation.isPending, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.PROJECT_EDIT_DIALOG}
			isActive={true}
			rootScopeDisabled={true}
			componentName="ProjectEditDialog"
		>
			<Dialog open onOpenChange={(open) => !open && handleCancel()}>
				<DialogContent
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle>Edit project</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="edit-project-name">Name</Label>
							<Input id="edit-project-name" value={name} onChange={(e) => setName(e.target.value)} />
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="edit-project-description">Description</Label>
							<Input
								id="edit-project-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What is this project for?"
							/>
						</div>
						<Field orientation="horizontal" className="w-auto gap-2">
							<Checkbox
								id="edit-project-visible"
								checked={visibleToOrganization}
								onCheckedChange={(checked) => setVisibleToOrganization(checked === true)}
								disabled={updateMutation.isPending}
							/>
							<FieldLabel htmlFor="edit-project-visible" className="cursor-pointer text-muted-foreground">
								Visible to the rest of your organization
							</FieldLabel>
						</Field>
					</div>
					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button variant="secondary" disabled={updateMutation.isPending} onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button disabled={!canSave} onClick={() => void save()}>
							{updateMutation.isPending ? 'Saving…' : 'Save'}
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
									? '⌘+Enter'
									: 'Ctrl+Enter'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
