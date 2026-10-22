import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Check, Github, Loader2, Plus, Ticket, Upload } from 'lucide-react'
import { useId, type ChangeEvent, type ReactNode } from 'react'

import type { LauncherV3TicketProvider } from '@/modules/launcher-v3/launcher-v3-form'

import type { LauncherAttachmentControlProps } from './launcher-attachment-types'

const MENU_LABEL_CLASS = 'font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground'
const PROVIDER_OPTIONS: ReadonlyArray<{ value: LauncherV3TicketProvider; label: string }> = [
	{ value: 'linear', label: 'Linear' },
	{ value: 'github', label: 'GitHub' },
	{ value: 'jira', label: 'Jira' },
]

function ProviderIcon({ provider }: { provider: LauncherV3TicketProvider }) {
	if (provider === 'github') return <Github aria-hidden className="size-3.5 shrink-0" />
	return <Ticket aria-hidden className="size-3.5 shrink-0" />
}

/** The tray control for adding file and ticket context. */
export function LauncherAttachmentControl({
	ticket,
	integrations,
	providerShortcuts,
	disabled = false,
	onAddTicket,
	onConnectIntegration,
	onAddFiles,
}: LauncherAttachmentControlProps) {
	const fileInputId = useId()
	const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.currentTarget.files ?? [])
		if (files.length > 0) onAddFiles(files)
		// Reset so removing and re-selecting the same file fires change again.
		event.currentTarget.value = ''
	}

	return (
		<section aria-label="Attachments" className="flex min-w-0 flex-wrap items-center gap-1">
			<input
				id={fileInputId}
				type="file"
				multiple
				className="sr-only"
				aria-label="Attach files"
				disabled={disabled}
				onChange={handleFiles}
			/>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-label="Add context"
								disabled={disabled}
								className="h-7 px-2"
							>
								<Plus aria-hidden className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent className="space-y-1.5 py-2">
						<p className="font-medium">Add context</p>
						{PROVIDER_OPTIONS.map((provider) => (
							<p key={provider.value} className="flex items-center justify-between gap-3">
								<span>{provider.label}</span>
								<KeyboardShortcut size="xs">{providerShortcuts[provider.value]}</KeyboardShortcut>
							</p>
						))}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent aria-label="Add context" align="start" className="w-72">
					<DropdownMenuLabel className={MENU_LABEL_CLASS}>Files</DropdownMenuLabel>
					<DropdownMenuItem asChild>
						<label
							htmlFor={fileInputId}
							className="focus:bg-accent/10 focus:text-foreground"
							aria-disabled={disabled}
						>
							<Upload aria-hidden className="size-3.5 text-[var(--terminal-accent)]" />
							<span className="flex min-w-0 flex-col">
								<span className="text-xs font-medium">Attach files</span>
								<span className="text-[10px] text-muted-foreground">
									Upload files and add them to the task
								</span>
							</span>
						</label>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className={MENU_LABEL_CLASS}>Tickets</DropdownMenuLabel>
					{PROVIDER_OPTIONS.map((provider) => {
						const integration = integrations[provider.value]
						const needsConnect = integration.status === 'unavailable'
						let integrationIndicator: ReactNode = null
						if (integration.status === 'loading') {
							integrationIndicator = (
								<Loader2
									aria-label={`${provider.label} availability loading`}
									className="size-3.5 animate-spin"
								/>
							)
						} else if (needsConnect) {
							integrationIndicator = (
								<span className="text-[10px] font-medium uppercase tracking-wider">
									{integration.actionLabel ?? 'Connect'}
								</span>
							)
						} else if (ticket?.provider === provider.value) {
							integrationIndicator = (
								<Check aria-label="Attached" className="size-3.5 text-[var(--terminal-success)]" />
							)
						}
						// Unavailable integrations stay clickable: selecting one starts
						// the inline connect flow instead of opening the ticket dialog.
						return (
							<DropdownMenuItem
								key={provider.value}
								disabled={disabled || integration.status === 'loading'}
								onSelect={() =>
									needsConnect ? onConnectIntegration(provider.value) : onAddTicket(provider.value)
								}
							>
								<ProviderIcon provider={provider.value} />
								<div className="flex w-full min-w-0 items-center justify-between gap-3">
									<span className="flex min-w-0 flex-col">
										<span className="text-xs font-medium">{provider.label}</span>
										<span className="text-[10px] text-muted-foreground">
											{integration.description}
										</span>
									</span>
									<span className="flex shrink-0 items-center gap-2">
										{integrationIndicator}
										<KeyboardShortcut size="xs">
											{providerShortcuts[provider.value]}
										</KeyboardShortcut>
									</span>
								</div>
							</DropdownMenuItem>
						)
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</section>
	)
}
