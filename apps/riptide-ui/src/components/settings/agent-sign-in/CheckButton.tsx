import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

export function CheckButton({
	isChecking,
	primary = false,
	onClick,
	children,
}: {
	isChecking: boolean
	primary?: boolean
	onClick: () => void
	children: ReactNode
}) {
	return (
		<Button
			type="button"
			variant={primary ? 'default' : 'secondary'}
			size="xs"
			disabled={isChecking}
			onClick={onClick}
		>
			<RefreshCw className={cn('size-3', isChecking && 'animate-spin')} /> {children}
		</Button>
	)
}
