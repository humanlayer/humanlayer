import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { SlackAutomationEventTypeSchema } from '@humanlayer/riptide-api-contract/api/integrations/slack/schemas'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { UserMultiSelect, type UserOption } from '@humanlayer/ui/components/user-multi-select'
import { cn } from '@humanlayer/ui/lib/utils'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
	AlertCircle,
	Bell,
	BellOff,
	Check,
	CheckCircle,
	ChevronsUpDown,
	ExternalLink,
	Info,
	Link2,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import z from 'zod/v4'

import { useRiptideApi } from '@/api/client'
import { useMountEffect } from '@/hooks/useMountEffect'
import { type ResolvedMember, useOrgMembers } from '@/hooks/useOrgMembers'

type SlackEventType = z.infer<typeof SlackAutomationEventTypeSchema>

const slackEventTypes: { value: SlackEventType; label: string }[] = [
	{ value: 'design-discussion', label: 'Design discussion created' },
	{ value: 'design-prd', label: 'PRD created' },
	{ value: 'design-tdd', label: 'TDD created' },
	{ value: 'structure-outline', label: 'Outline created' },
	{ value: 'comment', label: 'Comment created' },
]

const slackAutomationFormSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	channelId: z.string().min(1, 'Choose a Slack channel'),
	eventTypes: z.array(SlackAutomationEventTypeSchema).min(1, 'Choose at least one event type'),
	ownerUserIds: z.array(z.string()),
	enabled: z.boolean(),
})

type SlackAutomationFormValues = z.infer<typeof slackAutomationFormSchema>

const defaultSlackAutomationForm: SlackAutomationFormValues = {
	name: '',
	channelId: '',
	eventTypes: slackEventTypes.map((eventType) => eventType.value),
	ownerUserIds: [],
	enabled: true,
}

const SLACK_AUTOMATION_INTRO_DISMISSED_KEY = 'riptide-cloud.slackAutomationIntroDismissed'
const SLACK_INTEGRATION_DOCS_URL = 'https://docs.humanlayer.com/guide/slack-integration'

// null = editor closed; otherwise the automation being created or edited
type SlackAutomationEditor = { mode: 'create' } | { mode: 'edit'; id: string } | null

function uniqueSlackChannels<T extends { id: string }>(channels: T[]): T[] {
	const seen = new Set<string>()
	return channels.filter((channel) => {
		if (seen.has(channel.id)) return false
		seen.add(channel.id)
		return true
	})
}

function slackChannelPlaceholder(isLoading: boolean, isEmpty: boolean, isErrored: boolean): string {
	if (isLoading) return 'Loading...'
	if (isEmpty) return 'No channels found'
	if (isErrored) return 'Unable to load channels'
	return 'Choose channel'
}

function formatSlackEventLabels(eventTypes: readonly SlackEventType[]): string[] {
	return eventTypes.map((eventType) => slackEventTypes.find((item) => item.value === eventType)?.label ?? eventType)
}

function hasDismissedSlackAutomationIntro(): boolean {
	try {
		return window.localStorage.getItem(SLACK_AUTOMATION_INTRO_DISMISSED_KEY) === 'true'
	} catch {
		return true
	}
}

function dismissSlackAutomationIntro() {
	try {
		window.localStorage.setItem(SLACK_AUTOMATION_INTRO_DISMISSED_KEY, 'true')
	} catch {
		// Ignore storage failures; closing the dialog should still work for the current session.
	}
}

// Stacked square user avatars (the comment-participant pattern) showing an
// automation's artifact-owner filter. Renders nothing for org-wide automations.
function AutomationOwnerAvatars({
	ownerUserIds,
	memberFor,
}: {
	ownerUserIds: readonly string[] | null
	memberFor: (id: string) => ResolvedMember | undefined
}) {
	if (!ownerUserIds || ownerUserIds.length === 0) return null

	const owners = ownerUserIds.map((id) => {
		const member = memberFor(id)
		return {
			id,
			name: member?.displayName ?? 'Unknown user',
			avatarUrl: member?.avatarUrl,
			initials: member?.initials ?? '?',
		}
	})

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0">
					<AvatarGroup className="*:data-[slot=avatar]:ring-0">
						{owners.slice(0, 3).map((owner) => (
							<Avatar key={owner.id} className="size-5 border border-border">
								<AvatarImage src={owner.avatarUrl ?? ''} alt={owner.name} />
								<AvatarFallback className="text-[8px]">{owner.initials}</AvatarFallback>
							</Avatar>
						))}
						{owners.length > 3 && (
							<AvatarGroupCount className="size-5 text-[8px]">+{owners.length - 3}</AvatarGroupCount>
						)}
					</AvatarGroup>
				</span>
			</TooltipTrigger>
			<TooltipContent side="top" align="start" className="max-w-72">
				<p className="font-medium">Only notifies for artifacts owned by:</p>
				<ul className="mt-1 list-disc space-y-0.5 pl-4">
					{owners.map((owner) => (
						<li key={owner.id}>{owner.name}</li>
					))}
				</ul>
			</TooltipContent>
		</Tooltip>
	)
}

function IntegrationStatusBadge({ onDisconnect, isPending }: { onDisconnect: () => void; isPending: boolean }) {
	const [hovered, setHovered] = useState(false)

	if (isPending) {
		return (
			<Badge variant="secondary" className="gap-1">
				Disconnecting...
			</Badge>
		)
	}

	return (
		<div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
			{hovered ? (
				<Badge variant="destructive" className="gap-1 cursor-pointer" onClick={onDisconnect}>
					Disconnect?
				</Badge>
			) : (
				<Badge variant="default" className="gap-1">
					<CheckCircle className="h-3 w-3" />
					Connected
				</Badge>
			)}
		</div>
	)
}

export function SlackIntegrationCard() {
	const { client, queryClient: apiQueryClient } = useRiptideApi()
	const navigate = useNavigate()
	const { slack_error: slackError } = useSearch({ from: '/settings' })
	const [slackChannelPickerOpen, setSlackChannelPickerOpen] = useState(false)
	const [automationEditor, setAutomationEditor] = useState<SlackAutomationEditor>(null)
	const [automationIntroOpen, setAutomationIntroOpen] = useState(false)

	useMountEffect(() => {
		if (!slackError) return

		if (slackError === 'auth_failed') {
			toast.error('Failed to connect Slack. Please check your Slack app configuration and try again.')
		} else if (slackError === 'invalid_link') {
			toast.error('Slack install link is invalid or expired. Please generate a new handoff URL.')
		} else {
			toast.error('Unable to connect Slack. Please try again.')
		}

		navigate({ to: '/settings', search: {} })
	})

	const automationForm = useForm<SlackAutomationFormValues>({
		resolver: standardSchemaResolver(slackAutomationFormSchema),
		defaultValues: defaultSlackAutomationForm,
		reValidateMode: 'onChange',
	})

	const orgSettingsQuery = useQuery(
		apiQueryClient.auth.admin.organizations.settings.get.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const slackStatusQuery = useQuery(
		apiQueryClient.integrations.slack.getStatus.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const slackChannelsQuery = useQuery({
		...apiQueryClient.integrations.slack.listChannels.queryOptions({ input: {} }),
		enabled: !!(slackStatusQuery.data?.connected && !slackStatusQuery.data.needsReauth),
	})

	const slackAutomationsQuery = useQuery({
		...apiQueryClient.integrations.slack.listAutomations.queryOptions({ input: {} }),
		enabled: !!slackStatusQuery.data?.connected,
	})

	const { members, memberFor, isLoading: orgMembersLoading } = useOrgMembers()

	const ownerUserOptions = useMemo<UserOption[]>(
		() =>
			members.map((member) => ({
				id: member.id,
				name: member.displayName,
				description: member.email,
				avatarUrl: member.avatarUrl,
				initials: member.initials,
			})),
		[members],
	)

	const createSlackInstallUrlMutation = useMutation(
		apiQueryClient.integrations.slack.createInstallUrl.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url
			},
			onError: (error) => {
				Sentry.captureException(error instanceof Error ? error : new Error('Failed to start Slack install'), {
					tags: { action: 'connect_slack' },
				})
				toast.error(error.message || 'Failed to start Slack install')
			},
		}),
	)

	const disconnectSlackMutation = useMutation(
		apiQueryClient.integrations.slack.disconnect.mutationOptions({
			onSuccess: () => {
				toast.success('Slack disconnected')
				void slackStatusQuery.refetch()
				void orgSettingsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(error instanceof Error ? error : new Error('Failed to disconnect Slack'), {
					tags: { action: 'disconnect_slack' },
				})
				toast.error(error.message || 'Failed to disconnect Slack')
			},
		}),
	)

	const createSlackAutomationMutation = useMutation(
		apiQueryClient.integrations.slack.createAutomation.mutationOptions({
			onSuccess: () => {
				toast.success('Slack automation created')
				automationForm.reset(defaultSlackAutomationForm)
				setAutomationEditor(null)
				void slackAutomationsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to create Slack automation'),
					{
						tags: { action: 'create_slack_automation' },
					},
				)
				toast.error(error.message || 'Failed to create Slack automation')
			},
		}),
	)

	const updateSlackAutomationMutation = useMutation(
		apiQueryClient.integrations.slack.updateAutomation.mutationOptions({
			onSuccess: () => {
				toast.success('Slack automation updated')
				automationForm.reset(defaultSlackAutomationForm)
				setAutomationEditor(null)
				void slackAutomationsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update Slack automation'),
					{
						tags: { action: 'update_slack_automation' },
					},
				)
				toast.error(error.message || 'Failed to update Slack automation')
			},
		}),
	)

	// Inline enable/disable toggle from the automation list (the bell). Unlike the form save above, it
	// only refetches on success — it must not reset or close an open create/edit editor.
	const toggleSlackAutomationMutation = useMutation(
		apiQueryClient.integrations.slack.updateAutomation.mutationOptions({
			onSuccess: () => {
				void slackAutomationsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update Slack automation'),
					{
						tags: { action: 'toggle_slack_automation' },
					},
				)
				toast.error(error.message || 'Failed to update Slack automation')
			},
		}),
	)

	const deleteSlackAutomationMutation = useMutation(
		apiQueryClient.integrations.slack.deleteAutomation.mutationOptions({
			onSuccess: () => {
				toast.success('Slack automation deleted')
				void slackAutomationsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to delete Slack automation'),
					{
						tags: { action: 'delete_slack_automation' },
					},
				)
				toast.error(error.message || 'Failed to delete Slack automation')
			},
		}),
	)

	const updateOrgSettingsMutation = useMutation(
		apiQueryClient.auth.admin.organizations.settings.set.mutationOptions({
			onSuccess: () => {
				toast.success('Feature settings updated')
				void orgSettingsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update feature settings'),
					{
						tags: { action: 'update_org_settings' },
					},
				)
				toast.error(error.message || 'Failed to update feature settings')
			},
		}),
	)

	const copySlackInstallUrl = async () => {
		const { url } = await client.integrations.slack.createInstallUrl({})
		await navigator.clipboard.writeText(url)
		toast.success('Slack install URL copied')
	}

	const {
		data: slackChannelsData,
		isError: slackChannelsErrored,
		isFetching: slackChannelsFetching,
		isSuccess: slackChannelsLoaded,
		refetch: refetchSlackChannels,
	} = slackChannelsQuery

	const slackChannels = uniqueSlackChannels(slackChannelsData?.channels ?? [])
	const slackChannelsInitialLoading = slackChannelsFetching && slackChannelsData === undefined
	const slackChannelsEmpty = slackChannelsLoaded && slackChannels.length === 0
	const slackChannelsUnavailable = slackChannelsErrored || slackChannelsEmpty
	const channelPlaceholder = slackChannelPlaceholder(
		slackChannelsInitialLoading,
		slackChannelsEmpty,
		slackChannelsErrored,
	)

	const { data: slackAutomationsData, isSuccess: slackAutomationsLoaded } = slackAutomationsQuery
	const slackAutomations = slackAutomationsData?.automations ?? []
	const editorOpen = automationEditor !== null || (slackAutomationsLoaded && slackAutomations.length === 0)
	const editingId = automationEditor?.mode === 'edit' ? automationEditor.id : null

	useEffect(() => {
		if (!slackStatusQuery.data?.connected || slackStatusQuery.data.needsReauth) return
		if (hasDismissedSlackAutomationIntro()) return

		setAutomationIntroOpen(true)
	}, [slackStatusQuery.data?.connected, slackStatusQuery.data?.needsReauth])

	const showAutomationIntro = () => {
		if (!hasDismissedSlackAutomationIntro()) {
			setAutomationIntroOpen(true)
		}
	}

	const handleAutomationIntroOpenChange = (open: boolean) => {
		if (!open) {
			dismissSlackAutomationIntro()
		}
		setAutomationIntroOpen(open)
	}

	const openCreateAutomation = () => {
		showAutomationIntro()
		automationForm.reset(defaultSlackAutomationForm)
		setAutomationEditor({ mode: 'create' })
	}

	const openEditAutomation = (automation: (typeof slackAutomations)[number]) => {
		automationForm.reset({
			name: automation.name,
			channelId: automation.channelId,
			eventTypes: automation.eventTypes,
			ownerUserIds: automation.ownerUserIds ?? [],
			enabled: automation.enabled,
		})
		setAutomationEditor({ mode: 'edit', id: automation.id })
	}

	const closeAutomationEditor = () => {
		automationForm.reset(defaultSlackAutomationForm)
		setAutomationEditor(null)
	}

	const submitAutomation = automationForm.handleSubmit((values) => {
		const channel = slackChannels.find((item) => item.id === values.channelId)
		if (!channel) {
			toast.error(slackChannelsEmpty ? 'No Slack channels are available yet' : 'Choose a Slack channel')
			return
		}

		const input = {
			name: values.name,
			channelId: channel.id,
			channelName: channel.name,
			channelIsPrivate: channel.isPrivate,
			eventTypes: values.eventTypes,
			ownerUserIds: values.ownerUserIds.length > 0 ? values.ownerUserIds : null,
			enabled: values.enabled,
		}

		if (editingId) {
			updateSlackAutomationMutation.mutate({ id: editingId, ...input })
			return
		}

		showAutomationIntro()
		createSlackAutomationMutation.mutate(input)
	})

	return (
		<>
			<Dialog open={automationIntroOpen} onOpenChange={handleAutomationIntroOpenChange}>
				<DialogContent className="!max-w-4xl gap-5 p-0 overflow-hidden">
					<div className="space-y-4 p-6 pb-0">
						<DialogHeader>
							<DialogTitle>How Slack automations work</DialogTitle>
							<DialogDescription>
								A Slack automation sends selected HumanLayer events for selected users to one Slack
								channel. Create separate automations when different channels need different events or
								user filters.
							</DialogDescription>
						</DialogHeader>
						<div className="overflow-hidden rounded-lg border bg-muted/20">
							<img
								src="/integrations/slack-automation-diagram.png"
								alt="Diagram showing Slack automation events and users routing to a single channel"
								className="w-full"
							/>
						</div>
					</div>
					<DialogFooter className="border-t bg-muted/20 px-6 py-4">
						<Button variant="ghost" asChild>
							<a href={SLACK_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer">
								Read setup guide
								<ExternalLink className="ml-2 h-3.5 w-3.5" />
							</a>
						</Button>
						<Button onClick={() => handleAutomationIntroOpenChange(false)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<Label className="text-sm font-medium">Slack</Label>
						{slackStatusQuery.data?.connected && !slackStatusQuery.data.needsReauth && (
							<IntegrationStatusBadge
								onDisconnect={() => disconnectSlackMutation.mutate({})}
								isPending={disconnectSlackMutation.isPending}
							/>
						)}
						{slackStatusQuery.data?.needsReauth && (
							<Badge variant="destructive" className="gap-1">
								<AlertCircle className="h-3 w-3" />
								Needs Reconnection
							</Badge>
						)}
					</div>
					<Button variant="link" className="h-auto p-0 text-sm" asChild>
						<a href={SLACK_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer">
							Setup guide
							<ExternalLink className="ml-1 h-3.5 w-3.5" />
						</a>
					</Button>
				</div>
				<p className="text-sm text-muted-foreground">
					Connect Slack to send task artifact updates to your workspace.
				</p>
				{slackStatusQuery.data?.connected ? (
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-4">
							<div className="space-y-1">
								<Label className="text-sm">Enable Slack Notifications</Label>
								<p className="text-sm text-muted-foreground">
									Allow notification automations to post into Slack.
								</p>
							</div>
							<Switch
								checked={orgSettingsQuery.data?.slackIntegrationEnabled ?? false}
								onCheckedChange={(checked) =>
									updateOrgSettingsMutation.mutate({ slackIntegrationEnabled: checked })
								}
								disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
							/>
						</div>
						{slackStatusQuery.data.teamName && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Link2 className="h-4 w-4" />
								<span>{slackStatusQuery.data.teamName}</span>
							</div>
						)}
						{slackStatusQuery.data.needsReauth && (
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="destructive"
									onClick={() => createSlackInstallUrlMutation.mutate({})}
								>
									Reconnect Slack
								</Button>
								<Button size="sm" variant="ghost" onClick={copySlackInstallUrl}>
									Copy handoff URL
								</Button>
							</div>
						)}
						{!slackStatusQuery.data.needsReauth && (
							<div className="space-y-4 rounded-md border p-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<Label className="text-sm font-medium">Notification automations</Label>
										<p className="text-xs text-muted-foreground">
											Send selected task activity to Slack channels.
										</p>
									</div>
									{!editorOpen && (
										<Button size="sm" variant="outline" onClick={openCreateAutomation}>
											<Plus className="mr-2 h-4 w-4" />
											Create another automation
										</Button>
									)}
								</div>

								{editorOpen && (
									<form onSubmit={submitAutomation} className="space-y-3 rounded-md bg-muted/30 p-3">
										<div className="grid gap-3 md:grid-cols-[1fr_220px]">
											<Controller
												name="name"
												control={automationForm.control}
												render={({ field, fieldState }) => (
													<Field data-invalid={fieldState.invalid}>
														<FieldLabel htmlFor={field.name} className="text-xs">
															Automation name
														</FieldLabel>
														<Input
															{...field}
															id={field.name}
															aria-invalid={fieldState.invalid}
															placeholder="Task artifact updates"
														/>
														{fieldState.invalid && (
															<FieldError errors={[fieldState.error]} />
														)}
													</Field>
												)}
											/>
											<Controller
												name="channelId"
												control={automationForm.control}
												render={({ field, fieldState }) => {
													const selected = slackChannels.find(
														(channel) => channel.id === field.value,
													)
													return (
														<Field data-invalid={fieldState.invalid}>
															<FieldLabel className="text-xs">Channel</FieldLabel>
															<div className="flex items-center gap-2">
																<Popover
																	open={slackChannelPickerOpen}
																	onOpenChange={setSlackChannelPickerOpen}
																>
																	<PopoverTrigger asChild>
																		<Button
																			type="button"
																			variant="outline"
																			role="combobox"
																			aria-expanded={slackChannelPickerOpen}
																			className="flex-1 justify-between"
																			disabled={
																				slackChannelsInitialLoading ||
																				slackChannelsUnavailable
																			}
																		>
																			<span className="truncate">
																				{selected
																					? `#${selected.name}${selected.isPrivate ? ' (private)' : ''}`
																					: channelPlaceholder}
																			</span>
																			<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
																		</Button>
																	</PopoverTrigger>
																	<PopoverContent
																		className="w-[320px] p-0"
																		align="start"
																	>
																		<Command>
																			<CommandInput placeholder="Search channels..." />
																			<CommandList className="max-h-64">
																				<CommandEmpty>
																					No channels found.
																				</CommandEmpty>
																				<CommandGroup>
																					{slackChannels.map((channel) => (
																						<CommandItem
																							key={channel.id}
																							value={channel.id}
																							keywords={[
																								channel.name,
																								channel.id,
																							]}
																							onSelect={() => {
																								field.onChange(
																									channel.id,
																								)
																								setSlackChannelPickerOpen(
																									false,
																								)
																							}}
																						>
																							<Check
																								className={cn(
																									'h-4 w-4',
																									field.value ===
																										channel.id
																										? 'opacity-100'
																										: 'opacity-0',
																								)}
																							/>
																							<span className="truncate">
																								#{channel.name}
																							</span>
																							{channel.isPrivate && (
																								<span className="ml-auto text-xs text-muted-foreground">
																									private
																								</span>
																							)}
																						</CommandItem>
																					))}
																				</CommandGroup>
																			</CommandList>
																		</Command>
																	</PopoverContent>
																</Popover>
																<Button
																	type="button"
																	size="icon"
																	variant="ghost"
																	className="shrink-0"
																	onClick={() => refetchSlackChannels()}
																	disabled={slackChannelsFetching}
																	aria-label="Refresh Slack channels"
																>
																	<RefreshCw
																		className={cn(
																			'h-3.5 w-3.5',
																			slackChannelsFetching && 'animate-spin',
																		)}
																	/>
																</Button>
															</div>
															{fieldState.invalid && (
																<FieldError errors={[fieldState.error]} />
															)}
														</Field>
													)
												}}
											/>
										</div>

										<Controller
											name="eventTypes"
											control={automationForm.control}
											render={({ field, fieldState }) => (
												<Field data-invalid={fieldState.invalid}>
													<FieldLabel className="text-xs">Events</FieldLabel>
													<div className="flex flex-wrap gap-3">
														{slackEventTypes.map((eventType) => (
															<label
																key={eventType.value}
																className="flex items-center gap-2 text-sm"
															>
																<Checkbox
																	checked={field.value.includes(eventType.value)}
																	onCheckedChange={() =>
																		field.onChange(
																			field.value.includes(eventType.value)
																				? field.value.filter(
																						(value) =>
																							value !== eventType.value,
																					)
																				: [...field.value, eventType.value],
																		)
																	}
																/>
																{eventType.label}
															</label>
														))}
													</div>
													{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
												</Field>
											)}
										/>

										<Controller
											name="ownerUserIds"
											control={automationForm.control}
											render={({ field }) => {
												const selectedOwnerIds = new Set(field.value)
												return (
													<Field>
														<FieldLabel className="text-xs">
															Filter by artifact owner (optional)
														</FieldLabel>
														<p className="text-xs text-muted-foreground">
															Only notify for artifacts owned by these users. Leave empty
															to notify for all owners.
														</p>
														<UserMultiSelect
															users={ownerUserOptions}
															selectedIds={selectedOwnerIds}
															onSelectionChange={(next) =>
																field.onChange(Array.from(next))
															}
															placeholder="All owners"
															searchPlaceholder="Search users..."
															emptyMessage="No matching users"
															disabled={orgMembersLoading}
															className="w-full normal-case tracking-normal"
														/>
													</Field>
												)
											}}
										/>

										<div className="flex items-center justify-end gap-3">
											{editingId && (
												<Controller
													name="enabled"
													control={automationForm.control}
													render={({ field }) => (
														<label className="mr-auto flex items-center gap-2 text-sm">
															<Switch
																checked={field.value}
																onCheckedChange={field.onChange}
															/>
															Enabled
														</label>
													)}
												/>
											)}
											<div className="flex gap-2">
												{automationEditor !== null && (
													<Button
														type="button"
														size="sm"
														variant="ghost"
														onClick={closeAutomationEditor}
													>
														Cancel
													</Button>
												)}
												<Button
													type="submit"
													size="sm"
													disabled={
														createSlackAutomationMutation.isPending ||
														updateSlackAutomationMutation.isPending
													}
												>
													{editingId ? 'Save changes' : 'Create automation'}
												</Button>
											</div>
										</div>
									</form>
								)}

								{slackChannelsEmpty && (
									<p className="text-xs text-muted-foreground">
										No channels found. Confirm the Slack app has channels:read/groups:read scopes,
										then invite the HumanLayer app to private channels with /invite and refresh.
									</p>
								)}
								{slackChannelsErrored && (
									<p className="text-xs text-destructive">
										Unable to load Slack channels. Reconnect Slack or try refreshing channels.
									</p>
								)}

								<div className="space-y-2">
									{slackAutomationsLoaded && slackAutomations.length === 0 && (
										<p className="text-sm text-muted-foreground">No Slack automations yet.</p>
									)}
									{slackAutomations.map((automation) => (
										<div
											key={automation.id}
											className="flex items-center justify-between gap-3 rounded-md border p-2"
										>
											{/* Name + meta dim when the automation is disabled. */}
											<div className={cn('min-w-0', !automation.enabled && 'opacity-50')}>
												<div className="flex items-center gap-2">
													<span className="truncate text-sm font-medium">
														{automation.name}
													</span>
												</div>
												<div className="flex items-center gap-1 text-xs text-muted-foreground">
													<span className="truncate">
														#{automation.channelName ?? automation.channelId} -{' '}
														{automation.eventTypes.length} events
													</span>
													<Tooltip>
														<TooltipTrigger asChild>
															<button
																type="button"
																className="shrink-0 text-muted-foreground hover:text-foreground"
																aria-label="View notification events"
															>
																<Info className="h-3.5 w-3.5" />
															</button>
														</TooltipTrigger>
														<TooltipContent side="top" align="start" className="max-w-72">
															<p className="font-medium">
																Notifications are sent for the following events:
															</p>
															<ul className="mt-1 list-disc space-y-0.5 pl-4">
																{formatSlackEventLabels(automation.eventTypes).map(
																	(label) => (
																		<li key={label}>{label}</li>
																	),
																)}
															</ul>
														</TooltipContent>
													</Tooltip>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<div className={cn(!automation.enabled && 'opacity-50')}>
													<AutomationOwnerAvatars
														ownerUserIds={automation.ownerUserIds}
														memberFor={memberFor}
													/>
												</div>
												<div className="flex items-center gap-0.5">
													{/* Bell toggles enabled/disabled (mirrors the task-header control). */}
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																size="icon"
																variant="ghost"
																className="h-8 w-8"
																aria-label={
																	automation.enabled
																		? 'Disable automation'
																		: 'Enable automation'
																}
																onClick={() =>
																	toggleSlackAutomationMutation.mutate({
																		id: automation.id,
																		enabled: !automation.enabled,
																	})
																}
																disabled={toggleSlackAutomationMutation.isPending}
															>
																{automation.enabled ? (
																	<Bell className="h-4 w-4 text-primary" />
																) : (
																	<BellOff className="h-4 w-4 text-muted-foreground" />
																)}
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															{automation.enabled
																? 'Disable notifications'
																: 'Enable notifications'}
														</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																size="icon"
																variant="ghost"
																className="h-8 w-8"
																aria-label="Edit automation"
																onClick={() => openEditAutomation(automation)}
															>
																<Pencil className="h-4 w-4" />
															</Button>
														</TooltipTrigger>
														<TooltipContent>Edit</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																size="icon"
																variant="ghost"
																className="h-8 w-8 text-muted-foreground hover:text-destructive"
																aria-label="Delete automation"
																onClick={() =>
																	deleteSlackAutomationMutation.mutate({
																		id: automation.id,
																	})
																}
																disabled={deleteSlackAutomationMutation.isPending}
															>
																<Trash2 className="h-4 w-4" />
															</Button>
														</TooltipTrigger>
														<TooltipContent>Delete</TooltipContent>
													</Tooltip>
												</div>
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				) : (
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => createSlackInstallUrlMutation.mutate({})}
							disabled={createSlackInstallUrlMutation.isPending}
						>
							<Link2 className="mr-2 h-4 w-4" />
							Connect Slack
						</Button>
						<Button variant="ghost" onClick={copySlackInstallUrl}>
							Copy handoff URL
						</Button>
					</div>
				)}
			</div>
		</>
	)
}
