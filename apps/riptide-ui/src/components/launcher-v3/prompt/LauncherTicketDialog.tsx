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
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Check, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { GitHubRepositoryPicker, type GitHubRepositoryOption } from '@/components/GitHubRepositoryPicker'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'
import type { LauncherV3TicketProvider } from '@/modules/launcher-v3/launcher-v3-form'

import { TICKET_PROVIDER_LABELS } from './launcher-attachment-types'

const PROVIDER_PLACEHOLDERS: Readonly<Record<LauncherV3TicketProvider, string>> = {
	linear: 'ENG-123 or https://linear.app/acme/issue/ENG-123/title',
	jira: 'PROJ-123',
	github: 'Issue number or GitHub issue URL',
}

export interface LauncherTicketDialogProps {
	/** The dialog is open while a provider is being attached. */
	provider: LauncherV3TicketProvider | null
	input: string
	loading: boolean
	error: string | null
	/** Resolved display name; attaching is possible once this exists. */
	resolvedName: string | null
	githubRepositories: readonly GitHubRepositoryOption[]
	selectedGitHubRepositoryId: string | null
	disabled?: boolean
	onInputChange: (value: string) => void
	onSelectGitHubRepository: (repository: GitHubRepositoryOption) => void
	onAttach: () => void
	onClose: () => void
}

/** Modal ticket lookup: enter an ID or URL, watch it resolve, then attach. */
export function LauncherTicketDialog({
	provider,
	input,
	loading,
	error,
	resolvedName,
	githubRepositories,
	selectedGitHubRepositoryId,
	disabled = false,
	onInputChange,
	onSelectGitHubRepository,
	onAttach,
	onClose,
}: LauncherTicketDialogProps) {
	const isOpen = provider !== null
	const canAttach = isOpen && !disabled && !loading && resolvedName !== null

	useHotkeys(
		hotkeysCatalog.textEditing.shortcuts.launchDraft.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (canAttach) onAttach()
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.LAUNCHER_TICKET_DIALOG],
		},
		[isOpen, canAttach, onAttach],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			onClose()
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.LAUNCHER_TICKET_DIALOG],
		},
		[isOpen, onClose],
	)

	if (!provider) return null
	const label = TICKET_PROVIDER_LABELS[provider]
	const submitShortcut = formatShortcut(hotkeysCatalog.textEditing.shortcuts.launchDraft.display)
	let lookupStatus: ReactNode = null
	if (loading) {
		lookupStatus = (
			<span className="flex items-center gap-1.5 text-muted-foreground">
				<Loader2 aria-hidden className="size-3 animate-spin" /> Looking up ticket...
			</span>
		)
	} else if (error) {
		lookupStatus = (
			<p role="alert" className="text-destructive">
				{error}
			</p>
		)
	} else if (resolvedName) {
		lookupStatus = (
			<span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-[var(--terminal-success)]">
				<Check aria-hidden className="size-3 shrink-0" />
				<span className="min-w-0 truncate">{resolvedName}</span>
			</span>
		)
	}

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.LAUNCHER_TICKET_DIALOG}
			isActive={isOpen}
			rootScopeDisabled
			componentName="LauncherTicketDialog"
		>
			<Dialog open onOpenChange={(open) => !open && onClose()}>
				<DialogContent className="min-w-0 sm:max-w-2xl" onEscapeKeyDown={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>Attach a {label} ticket</DialogTitle>
						<DialogDescription>
							Paste a {label} {provider === 'jira' ? 'issue key' : 'issue ID or URL'}. The resolved ticket
							is imported into the task.
						</DialogDescription>
					</DialogHeader>
					<div className="min-w-0 space-y-3">
						{provider === 'github' && (
							<div role="group" aria-label="GitHub repository">
								<GitHubRepositoryPicker
									repositories={githubRepositories}
									selectedRepositoryId={selectedGitHubRepositoryId}
									onSelect={onSelectGitHubRepository}
									disabled={disabled}
								/>
							</div>
						)}
						<Input
							aria-label={`${label} ticket`}
							placeholder={PROVIDER_PLACEHOLDERS[provider]}
							value={input}
							disabled={disabled}
							spellCheck={false}
							autoFocus
							onChange={(event) => onInputChange(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
									event.preventDefault()
									if (canAttach) onAttach()
								}
							}}
						/>
						<div aria-live="polite" className="min-h-5 min-w-0 text-xs">
							{lookupStatus}
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={onClose}>
							Cancel <KeyboardShortcut size="xs">Esc</KeyboardShortcut>
						</Button>
						<Button type="button" disabled={!canAttach} onClick={onAttach}>
							Attach ticket <KeyboardShortcut size="xs">{submitShortcut}</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
