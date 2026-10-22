import { toast } from 'sonner'

import { CodeLayerToastButtons } from '@/components/CodeLayerToastButtons'
import { DismissableToastTitle } from '@/components/DismissableToastTitle'
import { useUpdate } from '@/hooks/use-update'
import { useMountEffect } from '@/hooks/useMountEffect'

// The global toaster outlives this subtree. Keep each notification scoped to
// the provider and update version whose modal its action can actually open.
function UpdateNotification({ version }: { version: string }) {
	const { urgency, setUpdateModalOpen } = useUpdate()

	useMountEffect(() => {
		if (urgency === 'critical') {
			setUpdateModalOpen(true)
		}

		const toastId = `update-available-${version}`

		toast(
			<DismissableToastTitle
				title="Update Available"
				titleClassName="font-bold text-[var(--terminal-info)]"
				description={`Version ${version}`}
				onDismiss={() => toast.dismiss(toastId)}
			/>,
			{
				id: toastId,
				duration: 8000,
				action: (
					<CodeLayerToastButtons
						action={{
							label: 'View Update',
							onClick: () => {
								toast.dismiss(toastId)
								setUpdateModalOpen(true)
							},
						}}
						variant="info"
						toastId={toastId}
					/>
				),
			},
		)
		return () => {
			toast.dismiss(toastId)
		}
	})

	return null
}

export function UpdateCheckHandler() {
	const { update } = useUpdate()

	return update ? <UpdateNotification key={update.version} version={update.version} /> : null
}
