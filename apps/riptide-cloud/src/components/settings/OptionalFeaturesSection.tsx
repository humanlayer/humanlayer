import { Label } from '@humanlayer/ui/components/label'
import { MultiplayerPromptingEnableDialog } from '@humanlayer/ui/components/multiplayer-prompting-enable-dialog'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { useUserInfo } from '@/hooks/useUserInfo'

export function OptionalFeaturesSection() {
	const { queryClient: apiQueryClient } = useRiptideApi()
	const [multiplayerPromptingDialogOpen, setMultiplayerPromptingDialogOpen] = useState(false)
	const queryClient = useQueryClient()
	const { advancedMetricsAvailable } = useUserInfo()

	const orgSettingsQuery = useQuery(
		apiQueryClient.auth.admin.organizations.settings.get.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const updateMultiplayerPrompting = (enabled: boolean) => {
		updateOrgSettingsMutation.mutate({ multiplayerPromptingEnabled: enabled })
	}

	const updateOrgSettingsMutation = useMutation(
		apiQueryClient.auth.admin.organizations.settings.set.mutationOptions({
			onSuccess: (_data, variables) => {
				toast.success('Feature settings updated')
				void orgSettingsQuery.refetch()
				if (variables.multiplayerPromptingEnabled) {
					setMultiplayerPromptingDialogOpen(false)
				}
				if (
					variables.commitTrackingEnabled !== undefined ||
					variables.prTrackingEnabled !== undefined ||
					variables.advancedMetricsVisibleToAllMembers !== undefined
				) {
					// The dashboard's locked tabs and its route guard read auth.user.info (cached
					// with staleTime: Infinity) — refresh it so they unlock without a reload.
					void queryClient.invalidateQueries({ queryKey: apiQueryClient.auth.user.info.key() })
				}
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update feature settings'),
					{ tags: { action: 'update_org_settings' } },
				)
				toast.error(
					isDefinedError(error) && typeof error.data?.message === 'string'
						? error.data.message
						: 'Could not save settings. Your change was not applied.',
				)
			},
		}),
	)

	const commitTrackingEnabled = orgSettingsQuery.data?.commitTrackingEnabled ?? false
	const prTrackingEnabled = orgSettingsQuery.data?.prTrackingEnabled ?? false
	const advancedMetricsVisibleToAllMembers = orgSettingsQuery.data?.advancedMetricsVisibleToAllMembers ?? false
	const showMetricsSwitches =
		advancedMetricsAvailable || commitTrackingEnabled || prTrackingEnabled || advancedMetricsVisibleToAllMembers

	return (
		<section>
			<div className="mb-4">
				<h2 className="text-base font-semibold">Optional features</h2>
				<p className="text-sm text-muted-foreground">
					Enable or disable optional features for your organization. When disabled, users cannot enable these
					features in their settings.
				</p>
			</div>
			<div className="space-y-2">
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					<Switch
						checked={orgSettingsQuery.data?.multiplayerPromptingEnabled ?? false}
						onCheckedChange={(checked) => {
							if (checked) setMultiplayerPromptingDialogOpen(true)
							else updateMultiplayerPrompting(false)
						}}
						disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
						className="mt-0.5"
					/>
					<Label className="text-sm font-medium">Multiplayer prompting</Label>
					<p className="text-sm text-muted-foreground">
						Allow trusted teammates to send prompts to shared coding-agent sessions for an owner-approved
						window.
					</p>
				</div>
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					<Switch
						checked={orgSettingsQuery.data?.experimentalSubagentsEnabled ?? true}
						onCheckedChange={(checked) =>
							updateOrgSettingsMutation.mutate({ experimentalSubagentsEnabled: checked })
						}
						disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
						className="mt-0.5"
					/>
					<Label className="text-sm font-medium">HumanLayer Library Researcher</Label>
					<p className="text-sm text-muted-foreground">
						HumanLayer-managed context-efficient dependency &amp; library search tool that delegates to a
						cloud-based agentic workflow.
					</p>
				</div>
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					<Switch
						checked={orgSettingsQuery.data?.enableCreatingPubliclyShareableLinks ?? true}
						onCheckedChange={(checked) =>
							updateOrgSettingsMutation.mutate({ enableCreatingPubliclyShareableLinks: checked })
						}
						disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
						className="mt-0.5"
					/>
					<Label className="text-sm font-medium">Public shareable links</Label>
					<p className="text-sm text-muted-foreground">
						Allow users to create publicly shareable links to artifacts. When disabled, existing share links
						are revoked and users cannot create new ones.
					</p>
				</div>
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					<Switch
						checked={orgSettingsQuery.data?.accessRequestsEnabled ?? true}
						onCheckedChange={(checked) =>
							updateOrgSettingsMutation.mutate({ accessRequestsEnabled: checked })
						}
						disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
						className="mt-0.5"
					/>
					<Label className="text-sm font-medium">Access requests</Label>
					<p className="text-sm text-muted-foreground">
						Allow non-members to request access to artifacts in this organization. When disabled, visitors
						to artifact URLs see "Not Found" instead of a Request Access screen, hiding the organization's
						existence from outsiders.
					</p>
				</div>
				{showMetricsSwitches && (
					<>
						<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
							<Switch
								checked={commitTrackingEnabled}
								onCheckedChange={(checked) =>
									updateOrgSettingsMutation.mutate({ commitTrackingEnabled: checked })
								}
								disabled={
									orgSettingsQuery.isLoading ||
									updateOrgSettingsMutation.isPending ||
									(!advancedMetricsAvailable && !commitTrackingEnabled)
								}
								className="mt-0.5"
							/>
							<Label className="text-sm font-medium">Commit tracking</Label>
							{/* The per-field lists and the propagation delay live in the tooltip, not the
							    row: they answer "what are you reading from my repos?", so whoever hesitates
							    over the switch hovers, and nobody else reads them on every render. */}
							<p className="text-sm text-muted-foreground">
								Attribute agent commits to sessions for Advanced metrics: cost per commit and per 1,000
								lines changed. Metadata only &mdash; no source code leaves a member's machine. Covers
								every member unless excluded in the Users panel.{' '}
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											className="cursor-help underline decoration-dotted underline-offset-2"
										>
											What gets sent
										</button>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										Commits attributed to an agent send their message and changed file paths.
										Commits with no agent attribution send only the sha, repository, timestamp, and
										line counts &mdash; no message, author, branch, or file paths. Turning this on
										or off reaches a member the next time their daemon starts or runs a session, and
										within a day either way.
									</TooltipContent>
								</Tooltip>
							</p>
						</div>
						<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
							<Switch
								checked={prTrackingEnabled}
								onCheckedChange={(checked) =>
									updateOrgSettingsMutation.mutate({ prTrackingEnabled: checked })
								}
								disabled={
									orgSettingsQuery.isLoading ||
									updateOrgSettingsMutation.isPending ||
									(!advancedMetricsAvailable && !prTrackingEnabled) ||
									(!commitTrackingEnabled && !prTrackingEnabled)
								}
								className="mt-0.5"
							/>
							<Label className="text-sm font-medium">Pull request tracking</Label>
							<p className="text-sm text-muted-foreground">
								Adds cost per merged pull request to Advanced metrics, for branches your sessions
								committed on. Needs commit tracking on and the HumanLayer GitHub App installed.{' '}
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											className="cursor-help underline decoration-dotted underline-offset-2"
										>
											What gets sent
										</button>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										Nothing beyond commit tracking leaves a member's machine. HumanLayer reads the
										pull request's number, title, state, author, and timestamps from GitHub and
										matches its branch to the sessions whose commits are on it.
									</TooltipContent>
								</Tooltip>
							</p>
						</div>
						<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
							<Switch
								checked={advancedMetricsVisibleToAllMembers}
								onCheckedChange={(checked) =>
									updateOrgSettingsMutation.mutate({ advancedMetricsVisibleToAllMembers: checked })
								}
								disabled={
									orgSettingsQuery.isLoading ||
									updateOrgSettingsMutation.isPending ||
									(!advancedMetricsAvailable && !advancedMetricsVisibleToAllMembers)
								}
								className="mt-0.5"
							/>
							<Label className="text-sm font-medium">Advanced metrics for everyone</Label>
							<p className="text-sm text-muted-foreground">
								Let every member open Advanced metrics, not just admins. The page names individual
								members alongside what they spend and what they ship, so everyone would see that about
								everyone else. Admins keep access either way.
							</p>
						</div>
					</>
				)}
			</div>
			<MultiplayerPromptingEnableDialog
				open={multiplayerPromptingDialogOpen}
				onOpenChange={setMultiplayerPromptingDialogOpen}
				onConfirm={() => updateOrgSettingsMutation.mutate({ multiplayerPromptingEnabled: true })}
				isPending={updateOrgSettingsMutation.isPending}
			/>
		</section>
	)
}
