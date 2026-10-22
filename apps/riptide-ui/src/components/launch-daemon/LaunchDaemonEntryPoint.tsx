import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'

interface LaunchDaemonEntryPointProps {
	onClick: () => void
	disabled?: boolean
	variant?: 'link' | 'outline' | 'secondary'
	className?: string
}

export function LaunchDaemonEntryPoint({
	onClick,
	disabled = false,
	variant = 'outline',
	className,
}: LaunchDaemonEntryPointProps) {
	const computedClassName =
		variant === 'link'
			? cn('h-auto p-0 text-xs normal-case tracking-normal', className)
			: cn('h-7 px-2 normal-case tracking-normal', className)

	return (
		<Button
			type="button"
			variant={variant}
			size="sm"
			onClick={onClick}
			disabled={disabled}
			className={computedClassName}
		>
			Launch daemon
		</Button>
	)
}
