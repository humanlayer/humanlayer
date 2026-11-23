import type { LauncherV3FormAttachment, LauncherV3TicketProvider } from '@/modules/launcher-v3/launcher-v3-form'

/**
 * - `unavailable`: this organization has not connected it; selecting it starts the connect flow.
 * - `unsupported`: this deployment has no keys for it; the description says who can fix that, and
 *   selecting it does nothing.
 */
export type LauncherTicketIntegrationStatus = 'available' | 'loading' | 'unavailable' | 'unsupported'

export interface LauncherTicketIntegrationState {
	status: LauncherTicketIntegrationStatus
	description: string
	actionLabel?: string
}

export interface LauncherAttachmentTicketChip {
	provider: LauncherV3TicketProvider
	ticketId: string
	name: string
}

export interface LauncherAttachmentControlProps {
	ticket: LauncherAttachmentTicketChip | null
	integrations: Readonly<Record<LauncherV3TicketProvider, LauncherTicketIntegrationState>>
	providerShortcuts: Readonly<Record<LauncherV3TicketProvider, string>>
	disabled?: boolean
	onAddTicket: (provider: LauncherV3TicketProvider) => void
	onConnectIntegration: (provider: LauncherV3TicketProvider) => void
	onAddFiles: (files: File[]) => void
}

export interface LauncherAttachmentChipsProps {
	ticket: LauncherAttachmentTicketChip | null
	attachments: readonly LauncherV3FormAttachment[]
	uploadingFileNames: readonly string[]
	disabled?: boolean
	onRemoveTicket: () => void
	onRemoveFile: (fileName: string) => void
}

export const TICKET_PROVIDER_LABELS: Readonly<Record<LauncherV3TicketProvider, string>> = {
	linear: 'Linear',
	github: 'GitHub',
	jira: 'Jira',
}
