/**
 * IssueSourceSection.tsx
 *
 * Section component for issue source selection (inline/linear/jira) and ticket fields.
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Internalizes:
 * - Integration availability from settingsStore
 * - Admin check from useBrowserAuth
 * - Global issue source preference setter from taskSettingsStore
 */

import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Textarea } from '@humanlayer/ui/components/textarea'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useFormState, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { GitHubIssueInput } from '@/components/GitHubIssueInput'
import { GitHubIssuePreview, type GitHubIssuePreviewData } from '@/components/GitHubIssuePreview'
import { GitHubRepositoryPicker, type GitHubRepositoryOption } from '@/components/GitHubRepositoryPicker'
import { IntegrationCTA } from '@/components/IntegrationCTA'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { isLookupError, type TicketLookupError } from '@/lib/ticket-lookup-error'
import { openCloudUrl, openExternal } from '@/lib/url-opener'
import { useRiptideApi } from '@/orpc/client'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

import { AxisSelector, type IssueSource } from './shared'

interface TicketInputFieldProps {
	ticketLabel: string
	ticketIdInputId: string
	placeholder: string
	ticketId: string
	onTicketIdChange: (value: string) => void
	isFetching: boolean
	isSubmitting: boolean
	error?: { message?: string } | TicketLookupError
	/** Opens the org settings page — used in ticket-lookup error resolution hints. */
	onOpenExternal?: (e: React.MouseEvent) => void
}

const TicketInputField: FC<TicketInputFieldProps> = ({
	ticketLabel,
	ticketIdInputId,
	placeholder,
	ticketId,
	onTicketIdChange,
	isFetching,
	isSubmitting,
	error,
	onOpenExternal,
}) => {
	return (
		<Field data-invalid={!!error}>
			<FieldLabel>{ticketLabel}</FieldLabel>
			<div className="relative">
				<Input
					id={ticketIdInputId}
					value={ticketId}
					onChange={(e) => onTicketIdChange(e.target.value)}
					placeholder={placeholder}
					disabled={isSubmitting}
					className="font-mono pr-8"
					aria-invalid={!!error}
				/>
				{isFetching && (
					<SyncGridAnimation
						variant="snake"
						size="sm"
						speed={120}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
				)}
			</div>
			{error && !isLookupError(error) && <FieldError errors={[error]} />}
			{error && isLookupError(error) && (
				<div className="space-y-1 text-sm text-destructive">
					<p>{error.message}</p>
					{error.resolutionHint && (
						<p>
							{error.resolutionHint.text}{' '}
							<button type="button" className="underline" onClick={onOpenExternal}>
								{error.resolutionHint.anchorText}
							</button>
						</p>
					)}
				</div>
			)}
		</Field>
	)
}

export interface IssueSourceSectionProps {
	// Ticket fetch state (computed in parent via useTicketAutoFetch)
	isFetchingTicket: boolean
	isFetchingJiraTicket: boolean
	linearLookupError: TicketLookupError | null
	githubRepositories: ReadonlyArray<GitHubRepositoryOption>
	selectedGitHubRepository: GitHubRepositoryOption | null
	onSelectGitHubRepository: (repository: GitHubRepositoryOption) => void
	onGitHubIssueInputChange: (value: string) => void
	githubPreview: GitHubIssuePreviewData | null
	isFetchingGitHubPreview: boolean
	githubInputError: string | null
	githubEnabled: boolean
	githubDisabledReason: string | null

	// Axis preferences persistence (needs parent context for hostId/directory)
	persistAxisPreferences: (partial: { issueSource?: IssueSource }) => void
}

export const IssueSourceSection: FC<IssueSourceSectionProps> = ({
	isFetchingTicket,
	isFetchingJiraTicket,
	linearLookupError,
	githubRepositories,
	selectedGitHubRepository,
	onSelectGitHubRepository,
	onGitHubIssueInputChange,
	githubPreview,
	isFetchingGitHubPreview,
	githubInputError,
	githubEnabled,
	githubDisabledReason,
	persistAxisPreferences,
}) => {
	const { client } = useRiptideApi()
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)

	// Integration availability from settingsStore
	const linearEnabled = useSettingsStore((s) => s.linearEnabled)
	const jiraEnabled = useSettingsStore((s) => s.jiraEnabled)
	const linearNeedsReauth = useSettingsStore((s) => s.linearNeedsReauth)
	const jiraNeedsReauth = useSettingsStore((s) => s.jiraNeedsReauth)

	// Global preference setter from taskSettingsStore
	const setV2IssueSource = useTaskSettingsStore((s) => s.setV2IssueSource)

	// Admin check from useBrowserAuth
	const { roles } = useBrowserAuth()
	const isAdmin = roles?.includes('admin') ?? false

	const issueSource = useWatch({ control: form?.control, name: 'issueSource' }) as IssueSource | undefined
	const ticketDescription = useWatch({ control: form?.control, name: 'ticketDescription' })
	const ticketId = useWatch({ control: form?.control, name: 'ticketId' })
	// formState on the passed-in form only re-renders the component that called useForm, so this
	// section has to subscribe to errors itself or a failed submit leaves the field looking valid.
	const { errors } = useFormState({ control: form?.control, name: 'ticketId' })

	const isSubmitting = submitState.isSubmitting
	const settingsUrl = getOrgSettingsUrl()

	const handleOpenExternal = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			openCloudUrl(settingsUrl)
		},
		[settingsUrl],
	)

	const handleConnectLinear = useCallback(async () => {
		try {
			const { url } = await client.integrations.linear.createInstallUrl({ client: 'native' })
			await openExternal(url)
		} catch (error) {
			toast.error('Unable to start the Linear connection. Open settings to try again.')
			throw error
		}
	}, [client])

	const handleConnectJira = useCallback(async () => {
		try {
			const { url } = await client.integrations.jira.createInstallUrl({ client: 'native' })
			await openExternal(url)
		} catch (error) {
			toast.error('Unable to start the Jira connection. Open settings to try again.')
			throw error
		}
	}, [client])

	const handleIssueSourceChange = useCallback(
		(value: IssueSource) => {
			form?.setValue('issueSource', value, { shouldValidate: true })
			setV2IssueSource(value)
			persistAxisPreferences({ issueSource: value })
		},
		[form, setV2IssueSource, persistAxisPreferences],
	)

	const handleTicketDescriptionChange = useCallback(
		(value: string) => {
			form?.setValue('ticketDescription', value)
		},
		[form],
	)

	const handleTicketIdChange = useCallback(
		(value: string) => {
			form?.setValue('ticketId', value, { shouldValidate: true })
		},
		[form],
	)

	if (!form) return null

	const issueSourceOptions: { value: IssueSource; label: string; description: string }[] = [
		{
			value: 'inline',
			label: 'Inline',
			description: 'Describe the task directly',
		},
		{
			value: 'linear',
			label: 'Linear',
			description: linearEnabled ? 'Import from a Linear ticket' : 'Connect Linear in settings to enable',
		},
		{
			value: 'jira',
			label: 'Jira',
			description: jiraEnabled ? 'Import from a Jira ticket' : 'Connect Jira in settings to enable',
		},
		{
			value: 'github',
			label: 'GitHub',
			description: githubEnabled ? 'Import from an installed repository' : 'Connect GitHub in settings to enable',
		},
	]

	const isLinear = issueSource === 'linear'
	const isJira = issueSource === 'jira'
	const isGitHub = issueSource === 'github'

	return (
		<>
			{/* Issue source axis */}
			<AxisSelector
				label="Issue Source"
				options={issueSourceOptions}
				selected={issueSource ?? 'inline'}
				onSelect={handleIssueSourceChange}
				disabled={isSubmitting}
			/>

			{/* Inline task description */}
			{issueSource === 'inline' && (
				<Field>
					<Textarea
						id="ticket-description"
						value={ticketDescription ?? ''}
						onChange={(e) => handleTicketDescriptionChange(e.target.value)}
						placeholder="Describe what you want to build..."
						rows={6}
						className="text-xs"
						disabled={isSubmitting}
					/>
				</Field>
			)}

			{/* Linear: connection CTA or ticket ID input */}
			{isLinear && !linearEnabled && (
				<IntegrationCTA
					name="Linear"
					needsReauth={linearNeedsReauth}
					isAdmin={isAdmin}
					settingsUrl={settingsUrl}
					onOpenExternal={handleOpenExternal}
					onConnect={handleConnectLinear}
				/>
			)}
			{isLinear && linearEnabled && (
				<TicketInputField
					ticketLabel="Linear Ticket ID or URL"
					ticketIdInputId="linear-ticket-id"
					placeholder="ENG-123 or https://linear.app/acme/issue/ENG-123/title"
					ticketId={ticketId ?? ''}
					onTicketIdChange={handleTicketIdChange}
					isFetching={isFetchingTicket}
					isSubmitting={isSubmitting}
					error={errors.ticketId ?? linearLookupError ?? undefined}
					onOpenExternal={handleOpenExternal}
				/>
			)}

			{/* Jira: connection CTA or ticket key input */}
			{isJira && !jiraEnabled && (
				<IntegrationCTA
					name="Jira"
					needsReauth={jiraNeedsReauth}
					isAdmin={isAdmin}
					settingsUrl={settingsUrl}
					onOpenExternal={handleOpenExternal}
					onConnect={handleConnectJira}
				/>
			)}
			{isJira && jiraEnabled && (
				<TicketInputField
					ticketLabel="Jira Ticket Key"
					ticketIdInputId="jira-ticket-id"
					placeholder="PROJ-123"
					ticketId={ticketId ?? ''}
					onTicketIdChange={handleTicketIdChange}
					isFetching={isFetchingJiraTicket}
					isSubmitting={isSubmitting}
					error={errors.ticketId}
					onOpenExternal={handleOpenExternal}
				/>
			)}

			{isGitHub && !githubEnabled && (
				<div className="space-y-2">
					<IntegrationCTA
						name="GitHub"
						needsReauth={false}
						isAdmin={isAdmin}
						settingsUrl={settingsUrl}
						onOpenExternal={handleOpenExternal}
					/>
					{githubDisabledReason && <p className="text-xs text-muted-foreground">{githubDisabledReason}</p>}
				</div>
			)}

			{isGitHub && githubEnabled && (
				<div className="space-y-4">
					<Field>
						<FieldLabel>Installed repository</FieldLabel>
						<GitHubRepositoryPicker
							repositories={githubRepositories}
							selectedRepositoryId={selectedGitHubRepository?.repositoryId ?? null}
							onSelect={onSelectGitHubRepository}
							disabled={isSubmitting}
						/>
					</Field>
					<GitHubIssueInput
						value={ticketId ?? ''}
						onChange={onGitHubIssueInputChange}
						isFetching={isFetchingGitHubPreview}
						disabled={isSubmitting}
						error={githubInputError ?? errors.ticketId?.message ?? null}
					/>
					{githubPreview && <GitHubIssuePreview preview={githubPreview} />}
				</div>
			)}
		</>
	)
}
