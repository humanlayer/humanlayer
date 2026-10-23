import type { AnyRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import type { createTaskActions } from '@/actions/tasks'
import type { NewTaskFormV2Input } from '@/components/NewTaskFormV2'
import { parseLinearIssueInput } from '@/lib/linear-issue-input'
import { generateTaskSlug } from '@/lib/task-slug'

function getDraftTicketId(values: NewTaskFormV2Input): string | undefined {
	if (values.issueSource !== 'linear') return values.ticketId || undefined

	const parsed = parseLinearIssueInput(values.ticketId ?? '')
	return parsed.ok ? parsed.issueId : values.ticketId || undefined
}

function getDraftTicketProvider(values: NewTaskFormV2Input): 'linear' | 'jira' | 'github' | undefined {
	if (values.issueSource === 'linear') return 'linear'
	if (values.issueSource === 'jira') return 'jira'
	if (values.issueSource === 'github') return 'github'
	return undefined
}

export interface UseDraftSaveActionsParams {
	form: UseFormReturn<NewTaskFormV2Input>
	draftId: string | undefined
	displaySlug: string
	taskActions: ReturnType<typeof createTaskActions>
	userId: string | null | undefined
	dbOrganizationId: string | null | undefined
	githubRepository: {
		readonly connectionId: string
		readonly repositoryId: string
		readonly fullName: string
	} | null
	router: AnyRouter
}

export type DraftSaveAction = 'auto-save' | 'prompt' | 'none'

export function useDraftSaveActions({
	form,
	draftId,
	displaySlug,
	taskActions,
	userId,
	dbOrganizationId,
	githubRepository,
	router,
}: UseDraftSaveActionsParams) {
	/**
	 * Determine if the user should be prompted to save their draft before navigating away.
	 * Returns 'auto-save' if editing existing draft with content (save silently),
	 * 'prompt' if new draft with content (show dialog),
	 * 'none' if form is empty.
	 */
	const shouldPromptToSaveDraft = useCallback((): DraftSaveAction => {
		const values = form.getValues()
		const hasName = values.name.trim() !== ''
		const hasTicketDescription = values.ticketDescription?.trim() !== ''
		const hasTicketId = values.ticketId?.trim() !== ''

		const hasContent = hasName || hasTicketDescription || hasTicketId

		if (draftId && hasContent) {
			return 'auto-save'
		}

		if (hasContent) {
			return 'prompt'
		}

		return 'none'
	}, [form, draftId])

	/**
	 * Save the current form as a draft (create new or update existing).
	 */
	const handleSaveDraft = useCallback(async () => {
		const values = form.getValues()
		const slug = displaySlug || generateTaskSlug(values.name)
		const ticketId = getDraftTicketId(values)
		const ticketProvider = getDraftTicketProvider(values)
		const githubRepositoryIdentity =
			values.issueSource === 'github' && githubRepository
				? {
						githubConnectionId: githubRepository.connectionId,
						ticketRepositoryId: githubRepository.repositoryId,
						ticketRepositoryFullName: githubRepository.fullName,
					}
				: { githubConnectionId: null, ticketRepositoryId: null, ticketRepositoryFullName: null }

		if (draftId) {
			taskActions.updateTaskDraft({
				taskId: draftId,
				name: values.name,
				slug: slug || undefined,
				defaultWorkingDirectory: values.directory || undefined,
				ticketId,
				ticketDescription: values.ticketDescription || undefined,
				ticketProvider,
				...githubRepositoryIdentity,
			})
			toast.success('Task draft saved')
		} else {
			const newDraftId = uuidv7()
			taskActions.createTaskDraft({
				id: newDraftId,
				userId: userId ?? '',
				dbOrganizationId: dbOrganizationId ?? '',
				name: values.name || 'Untitled Draft',
				slug: slug || undefined,
				defaultWorkingDirectory: values.directory || undefined,
				ticketId,
				ticketDescription: values.ticketDescription || undefined,
				ticketProvider,
				...githubRepositoryIdentity,
			})
			toast.success('Task draft saved')
		}
	}, [form, draftId, displaySlug, taskActions, userId, dbOrganizationId, githubRepository])

	/**
	 * Handle the discard action from SaveDraftDialog - just navigate back without saving.
	 */
	const handleDiscardDraft = useCallback(() => {
		router.history.back()
	}, [router])

	return {
		shouldPromptToSaveDraft,
		handleSaveDraft,
		handleDiscardDraft,
	}
}
