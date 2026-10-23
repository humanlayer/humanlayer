import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { useRef } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import z from 'zod/v4'

import { useMountEffect } from '@/hooks/useMountEffect'
import { getHostId as getDesktopHostId } from '@/integrations/desktop/host'
import { discoverGitRepositories as discoverGitRepositoriesOnDesktop } from '@/integrations/desktop/repository-discovery'
import { isDesktop } from '@/lib/utils'

import { ProjectRepositoryEditor } from './ProjectRepositoryEditor'
import {
	ProjectRepositoryPicker,
	type ProjectGitHubRepository,
	type ProjectRepositorySelection,
} from './ProjectRepositoryPicker'

export type { ProjectGitHubRepository } from './ProjectRepositoryPicker'

export interface ProjectCreatorSubmission {
	readonly name: string
	readonly description: string | null
	readonly private: boolean
	readonly hostId?: string
	readonly repositoryPaths?: Record<string, string>
	readonly repositories: Array<{
		remoteUrl: string
		repositoryIdentity: string
		defaultBranch: string
		default: boolean
		autoPushBranch: boolean
		copyGlobs: string[]
		setupCommand?: string
	}>
}

const projectCreatorFormSchema = z.object({
	name: z.string().trim().min(1, 'Project name is required'),
	description: z.string().optional(),
	visibleToOrganization: z.boolean(),
	repositories: z
		.array(
			z.object({
				path: z.string().nullable(),
				remoteUrl: z
					.string()
					.refine((value) => Boolean(normalizeRepositoryIdentity(value)), 'Unsupported Git remote URL'),
				remotes: z.array(z.object({ name: z.string(), url: z.string() })),
				defaultBranch: z.string().trim().min(1, 'Default branch is required'),
				default: z.boolean(),
				copyGlobsText: z.string(),
				setupCommand: z.string(),
				autoPushBranch: z.boolean(),
			}),
		)
		.min(1, 'Add at least one repository')
		.superRefine((repositories, ctx) => {
			const identities = new Set<string>()
			for (const [index, repository] of repositories.entries()) {
				const identity = normalizeRepositoryIdentity(repository.remoteUrl)
				if (identity && identities.has(identity))
					ctx.addIssue({
						code: 'custom',
						path: [index, 'remoteUrl'],
						message: 'This repository is already in the project',
					})
				if (identity) identities.add(identity)
			}
			if (repositories.length && repositories.filter((repository) => repository.default).length !== 1)
				ctx.addIssue({ code: 'custom', message: 'Choose one default repository' })
		}),
})

export type ProjectCreatorFormValues = z.infer<typeof projectCreatorFormSchema>

const NO_GITHUB_REPOSITORIES: ReadonlyArray<ProjectGitHubRepository> = []

export function ProjectCreator({
	onCreate,
	onCancel,
	pending,
	formRef,
	discoverRepositories = discoverGitRepositoriesOnDesktop,
	getLocalHostId = getDesktopHostId,
	githubRepositories = NO_GITHUB_REPOSITORIES,
	githubRepositoriesLoading = false,
	githubError,
	githubConnected,
	onSubmittingChange,
	repositoryPickerPortalContainer,
}: {
	readonly onCreate: (submission: ProjectCreatorSubmission) => Promise<void>
	readonly onCancel?: () => void
	readonly pending: boolean
	readonly formRef?: React.Ref<HTMLFormElement>
	readonly discoverRepositories?: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>>
	readonly getLocalHostId?: () => Promise<string | null>
	readonly githubRepositories?: ReadonlyArray<ProjectGitHubRepository>
	readonly githubRepositoriesLoading?: boolean
	readonly githubError?: string
	readonly githubConnected?: boolean
	readonly onSubmittingChange?: (submitting: boolean) => void
	readonly repositoryPickerPortalContainer?: HTMLElement | null
}) {
	const form = useForm<z.infer<typeof projectCreatorFormSchema>>({
		resolver: standardSchemaResolver(projectCreatorFormSchema),
		defaultValues: { name: '', description: '', visibleToOrganization: false, repositories: [] },
		mode: 'onChange',
	})
	const { fields, append, remove } = useFieldArray({ control: form.control, name: 'repositories' })
	const staged = useWatch({ control: form.control, name: 'repositories' })
	const stagedIdentities = new Set(staged.map((entry) => normalizeRepositoryIdentity(entry.remoteUrl) ?? ''))
	const busy = pending || form.formState.isSubmitting
	const mounted = useRef(true)
	const submitting = useRef(false)
	useMountEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	})

	const stage = (selection: ProjectRepositorySelection) => {
		const repositoryIdentity = normalizeRepositoryIdentity(selection.remoteUrl)
		if (!repositoryIdentity) return toast.error(`Unsupported Git remote URL: ${selection.remoteUrl}`)
		// Directory discovery callbacks may resolve concurrently with an old render's handler.
		const current = form.getValues('repositories')
		if (current.some((entry) => normalizeRepositoryIdentity(entry.remoteUrl) === repositoryIdentity)) return
		append(
			{
				...selection,
				remotes: [...selection.remotes],
				default: current.length === 0,
				copyGlobsText: '',
				setupCommand: '',
				autoPushBranch: false,
			},
			{ shouldFocus: false },
		)
	}
	const submit = async ({
		name,
		description,
		visibleToOrganization,
		repositories: staged,
	}: ProjectCreatorFormValues) => {
		if (busy || submitting.current) return
		submitting.current = true
		onSubmittingChange?.(true)
		try {
			const repositories = staged.map((entry) => {
				const repositoryIdentity = normalizeRepositoryIdentity(entry.remoteUrl)
				if (!repositoryIdentity) throw new Error('Unsupported Git remote URL')
				return { ...entry, repositoryIdentity }
			})
			const hasLocalPaths = staged.some((entry) => entry.path !== null)
			const hostId = hasLocalPaths ? await getLocalHostId().catch(() => null) : null
			if (!mounted.current) return
			if (hasLocalPaths && !hostId)
				return toast.error('Saving local repository folders requires the local desktop host')
			const project = {
				name,
				description: description?.trim() || null,
				private: !visibleToOrganization,
				repositories: repositories.map((entry) => {
					const repository: ProjectCreatorSubmission['repositories'][number] = {
						remoteUrl: entry.remoteUrl,
						repositoryIdentity: entry.repositoryIdentity,
						defaultBranch: entry.defaultBranch.trim(),
						default: entry.default,
						autoPushBranch: entry.autoPushBranch,
						copyGlobs: entry.copyGlobsText
							.split('\n')
							.map((glob) => glob.trim())
							.filter(Boolean),
					}
					if (entry.setupCommand.trim()) repository.setupCommand = entry.setupCommand
					return repository
				}),
			}
			if (hostId) {
				await onCreate({
					...project,
					hostId,
					repositoryPaths: Object.fromEntries(
						repositories.flatMap((entry) =>
							entry.path === null ? [] : [[entry.repositoryIdentity, entry.path]],
						),
					),
				})
			} else {
				await onCreate(project)
			}
		} catch {
			toast.error('Failed to create project')
			return
		} finally {
			submitting.current = false
			if (mounted.current) onSubmittingChange?.(false)
		}
		if (!mounted.current) return
		form.reset()
	}

	return (
		<form ref={formRef} onSubmit={(event) => void form.handleSubmit(submit)(event)} className="min-w-0 space-y-3">
			<div className="grid gap-3 sm:grid-cols-2">
				{(['name', 'description'] as const).map((name) => (
					<Controller
						key={name}
						control={form.control}
						name={name}
						render={({ field, fieldState }) => (
							<Field data-invalid={fieldState.invalid} className="gap-1">
								<FieldLabel htmlFor={`project-creator-${name}`} className="text-xs">
									{name === 'name' ? 'Project name' : 'Description'}
								</FieldLabel>
								<Input
									{...field}
									className="h-7 px-2 py-1 text-xs md:text-xs"
									id={`project-creator-${name}`}
									aria-invalid={fieldState.invalid}
									placeholder={
										name === 'description' ? 'What is this project for? (optional)' : undefined
									}
									disabled={busy}
								/>
								{fieldState.error && <FieldError errors={[fieldState.error]} />}
							</Field>
						)}
					/>
				))}
			</div>
			<section aria-label="Project repositories" className="min-w-0 space-y-2">
				<div>
					<h2 className="text-sm font-semibold">Repositories</h2>
					<p className="text-xs text-muted-foreground">
						{isDesktop()
							? 'Find repositories already on your computer or choose from your organization’s GitHub repositories.'
							: 'Choose from your organization’s GitHub repositories or enter a Git remote. Local folder discovery is available in the desktop app only.'}
					</p>
				</div>
				<ProjectRepositoryPicker
					portalContainer={repositoryPickerPortalContainer}
					githubRepositories={githubRepositories}
					githubRepositoriesLoading={githubRepositoriesLoading}
					githubError={githubError}
					githubConnected={githubConnected}
					discoverRepositories={discoverRepositories}
					stagedIdentities={stagedIdentities}
					onSelect={stage}
					disabled={busy}
				/>
				{staged.length === 0 && (
					<p className="text-xs text-muted-foreground">
						Choose a repository to configure its branch, files to copy, and setup command.
					</p>
				)}
				<FieldError errors={[form.formState.errors.repositories?.root ?? form.formState.errors.repositories]} />
				{fields.map((entry, index) => (
					<ProjectRepositoryEditor
						key={entry.id}
						control={form.control}
						index={index}
						onDefault={() => {
							form.getValues('repositories').forEach((_, i) =>
								form.setValue(`repositories.${i}.default`, i === index, {
									shouldDirty: true,
									shouldValidate: true,
								}),
							)
						}}
						onRemove={() => {
							const wasDefault = form.getValues(`repositories.${index}.default`)
							remove(index)
							if (wasDefault && form.getValues('repositories').length)
								form.setValue('repositories.0.default', true, {
									shouldDirty: true,
									shouldValidate: true,
								})
						}}
						disabled={busy}
					/>
				))}
			</section>
			<div className="space-y-3 border-t border-border/50 pt-3">
				<Controller
					control={form.control}
					name="visibleToOrganization"
					render={({ field }) => (
						<Field orientation="horizontal" className="w-auto gap-2">
							<Checkbox
								id="project-creator-visible"
								name={field.name}
								ref={field.ref}
								checked={field.value}
								onBlur={field.onBlur}
								onCheckedChange={(checked) => field.onChange(checked === true)}
								disabled={busy}
							/>
							<FieldLabel
								htmlFor="project-creator-visible"
								className="cursor-pointer text-xs text-muted-foreground"
							>
								Visible to the rest of your organization
							</FieldLabel>
						</Field>
					)}
				/>
				<div className="flex items-center gap-2">
					<Button type="submit" size="sm" disabled={busy || staged.length === 0}>
						{busy ? 'Creating...' : 'Create project'} <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
					</Button>
					{onCancel && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								if (!submitting.current) onCancel()
							}}
						>
							Cancel
						</Button>
					)}
				</div>
			</div>
		</form>
	)
}
