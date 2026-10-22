import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { useDebounce } from '@uidotdev/usehooks'
import { useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { useGitHubIssuePreviewSource } from '@/hooks/useGitHubIssuePreviewSource'
import { useTicketAutoFetch } from '@/hooks/useTicketAutoFetch'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'
import { parseLinearIssueInput } from '@/lib/linear-issue-input'
import { generateTaskSlug } from '@/lib/task-slug'
import type {
	LauncherV3FormValues,
	LauncherV3TicketAttachment,
	LauncherV3TicketProvider,
} from '@/modules/launcher-v3/launcher-v3-form'

import type { LauncherTicketIntegrationState } from './launcher-attachment-types'
import { LauncherAttachmentControl } from './LauncherAttachmentControl'
import { LauncherTicketDialog } from './LauncherTicketDialog'

const PROVIDER_SHORTCUTS = {
	linear: hotkeysCatalog.launcherV3.shortcuts.attachLinear,
	github: hotkeysCatalog.launcherV3.shortcuts.attachGitHub,
	jira: hotkeysCatalog.launcherV3.shortcuts.attachJira,
} as const

function useProviderHotkey(provider: LauncherV3TicketProvider, onInvoke: (provider: LauncherV3TicketProvider) => void) {
	useHotkeys(
		PROVIDER_SHORTCUTS[provider].reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			onInvoke(provider)
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
		[provider, onInvoke],
	)
}

export interface LauncherAttachmentControlWiredProps {
	control: Control<LauncherV3FormValues>
	onAddFiles: (files: File[]) => void
	disabled?: boolean
}

function settingsIntegrationState({
	provider,
	enabled,
	needsReauth,
}: {
	provider: 'Linear' | 'Jira'
	enabled: boolean
	needsReauth: boolean
}): LauncherTicketIntegrationState {
	if (needsReauth) {
		return {
			status: 'unavailable',
			description: `Reconnect ${provider} to import issues`,
			actionLabel: 'Reconnect',
		}
	}
	return enabled
		? { status: 'available', description: `Import from a ${provider} issue` }
		: { status: 'unavailable', description: `Connect ${provider} to import issues`, actionLabel: 'Connect' }
}

export function LauncherAttachmentControlWired({ control, onAddFiles, disabled }: LauncherAttachmentControlWiredProps) {
	const { field: ticket } = useController({ control, name: 'ticket' })
	const [activeProvider, setActiveProvider] = useState<LauncherV3TicketProvider | null>(null)
	const [input, setInput] = useState('')
	const debouncedInput = useDebounce(input, 400)

	const linearEnabled = useSettingsStore((state) => state.linearEnabled)
	const linearNeedsReauth = useSettingsStore((state) => state.linearNeedsReauth)
	const jiraEnabled = useSettingsStore((state) => state.jiraEnabled)
	const jiraNeedsReauth = useSettingsStore((state) => state.jiraNeedsReauth)

	const ticketFetch = useTicketAutoFetch({
		watchedMode: activeProvider ?? 'inline',
		debouncedTicketId: activeProvider === 'linear' ? debouncedInput : '',
		debouncedJiraTicketId: activeProvider === 'jira' ? debouncedInput : '',
	})
	const github = useGitHubIssuePreviewSource({
		enabled: true,
		issueInput: activeProvider === 'github' ? input : '',
		setIssueInput: setInput,
	})

	const integrations = {
		linear: settingsIntegrationState({
			provider: 'Linear',
			enabled: linearEnabled,
			needsReauth: linearNeedsReauth,
		}),
		github: github.isLoadingRepositories
			? { status: 'loading', description: 'Checking installed GitHub repositories' }
			: github.isEnabled
				? { status: 'available', description: 'Import from an installed repository' }
				: {
						status: 'unavailable',
						description: github.disabledReason ?? 'Connect GitHub to import issues',
						actionLabel: 'Connect',
					},
		jira: settingsIntegrationState({ provider: 'Jira', enabled: jiraEnabled, needsReauth: jiraNeedsReauth }),
	} satisfies Readonly<Record<LauncherV3TicketProvider, LauncherTicketIntegrationState>>

	const connectIntegration = useConnectIntegrationAction()
	const connectAndMaybeOpen = async (provider: LauncherV3TicketProvider) => {
		// The stale-store case: the settings re-check finds the provider already
		// connected, so opening the ticket dialog is the action the user asked for.
		if ((await connectIntegration(provider)) === 'already-connected') openDialog(provider)
	}

	const openDialog = (provider: LauncherV3TicketProvider) => {
		setInput(ticket.value?.provider === provider ? ticket.value.ticketId : '')
		setActiveProvider(provider)
	}
	const closeDialog = () => {
		setActiveProvider(null)
		setInput('')
	}
	const invokeProvider = (provider: LauncherV3TicketProvider) => {
		const integration = integrations[provider]
		if (disabled || integration.status === 'loading') return
		if (integration.status === 'unavailable') {
			void connectAndMaybeOpen(provider)
			return
		}
		openDialog(provider)
	}

	useProviderHotkey('linear', invokeProvider)
	useProviderHotkey('github', invokeProvider)
	useProviderHotkey('jira', invokeProvider)

	// One resolved candidate per provider; attaching stores it on the form.
	const resolved = ((): LauncherV3TicketAttachment | null => {
		if (activeProvider === 'linear') {
			const parsed = parseLinearIssueInput(debouncedInput)
			if (!parsed.ok || !ticketFetch.linearName) return null
			return {
				provider: 'linear',
				ticketId: parsed.issueId.toUpperCase(),
				name: ticketFetch.linearName,
				slug: ticketFetch.linearSlug ?? generateTaskSlug(ticketFetch.linearName),
				url: ticketFetch.linearTicketUrl,
				githubRepository: null,
			}
		}
		if (activeProvider === 'jira') {
			if (!ticketFetch.jiraName) return null
			return {
				provider: 'jira',
				ticketId: debouncedInput.trim().toUpperCase(),
				name: ticketFetch.jiraName,
				slug: ticketFetch.jiraSlug ?? generateTaskSlug(ticketFetch.jiraName),
				url: ticketFetch.jiraTicketUrl,
				githubRepository: null,
			}
		}
		if (activeProvider === 'github') {
			if (!github.preview || !github.selectedRepository) return null
			const { issueNumber, title, url, repository } = github.preview
			return {
				provider: 'github',
				ticketId: String(issueNumber),
				name: `[${repository.fullName}#${issueNumber}] ${title}`,
				slug: `${repository.fullName.replace('/', '-')}-${issueNumber}-${generateTaskSlug(title)}`.toLowerCase(),
				url,
				githubRepository: github.selectedRepository,
			}
		}
		return null
	})()

	const linearInputError =
		activeProvider === 'linear' && debouncedInput.trim() && !parseLinearIssueInput(debouncedInput).ok
			? 'Enter a Linear issue ID or URL'
			: null
	let dialogError: string | null = null
	if (activeProvider === 'linear') dialogError = ticketFetch.linearLookupError?.message ?? linearInputError
	else if (activeProvider === 'jira') dialogError = ticketFetch.jiraLookupError?.message ?? null
	else if (activeProvider === 'github') dialogError = github.inputError

	let dialogLoading = false
	if (activeProvider === 'linear') dialogLoading = ticketFetch.isFetchingTicket || input !== debouncedInput
	else if (activeProvider === 'jira') dialogLoading = ticketFetch.isFetchingJiraTicket || input !== debouncedInput
	else if (activeProvider === 'github') {
		dialogLoading = github.isLoadingRepositories || github.isFetchingPreview
	}

	return (
		<>
			<LauncherAttachmentControl
				ticket={ticket.value}
				integrations={integrations}
				providerShortcuts={{
					linear: formatShortcut(PROVIDER_SHORTCUTS.linear.display),
					github: formatShortcut(PROVIDER_SHORTCUTS.github.display),
					jira: formatShortcut(PROVIDER_SHORTCUTS.jira.display),
				}}
				disabled={disabled}
				onAddTicket={invokeProvider}
				onConnectIntegration={invokeProvider}
				onAddFiles={onAddFiles}
			/>
			<LauncherTicketDialog
				provider={activeProvider}
				input={input}
				loading={dialogLoading && Boolean(input.trim())}
				error={input.trim() ? dialogError : null}
				resolvedName={resolved?.name ?? null}
				githubRepositories={github.repositories}
				selectedGitHubRepositoryId={github.selectedRepository?.repositoryId ?? null}
				disabled={disabled}
				onInputChange={(value) => {
					if (activeProvider === 'github') {
						github.changeIssueInput(value)
						return
					}
					setInput(value)
				}}
				onSelectGitHubRepository={github.selectRepository}
				onAttach={() => {
					if (!resolved) return
					// Replacing an existing ticket is an explicit user action: the
					// dialog was opened from the add menu and confirmed here.
					ticket.onChange(resolved)
					closeDialog()
				}}
				onClose={closeDialog}
			/>
		</>
	)
}
