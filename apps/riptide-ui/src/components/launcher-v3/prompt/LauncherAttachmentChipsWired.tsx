import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

import { LauncherAttachmentChips } from './LauncherAttachmentChips'

export interface LauncherAttachmentChipsWiredProps {
	control: Control<LauncherV3FormValues>
	uploadingFileNames: readonly string[]
	disabled?: boolean
}

export function LauncherAttachmentChipsWired({
	control,
	uploadingFileNames,
	disabled,
}: LauncherAttachmentChipsWiredProps) {
	const { field: ticket } = useController({ control, name: 'ticket' })
	const { field: attachments } = useController({ control, name: 'attachments' })

	return (
		<LauncherAttachmentChips
			ticket={ticket.value}
			attachments={attachments.value}
			uploadingFileNames={uploadingFileNames}
			disabled={disabled}
			onRemoveTicket={() => ticket.onChange(null)}
			onRemoveFile={(fileName) =>
				attachments.onChange(attachments.value.filter((attachment) => attachment.fileName !== fileName))
			}
		/>
	)
}
