import type { FC } from 'react'

import { useVirtualKeyboardInset } from '@/mobile/hooks/useVirtualKeyboardInset'

interface MobileAppLayoutProps {
	children: React.ReactNode
}

/**
 * Full-height flex container for mobile pages.
 * Applies safe area insets for notched devices (iOS/Android).
 *
 * Height is `100dvh` minus `--keyboard-inset` (published by
 * `useVirtualKeyboardInset`) so the bottom-anchored composer stays visible
 * above the on-screen keyboard instead of being covered by it.
 */
export const MobileAppLayout: FC<MobileAppLayoutProps> = ({ children }) => {
	useVirtualKeyboardInset()

	return (
		<div
			className="flex flex-col overflow-hidden bg-background text-foreground"
			style={{
				height: 'calc(100dvh - var(--keyboard-inset, 0px))',
				paddingTop: 'env(safe-area-inset-top)',
				paddingBottom: 'env(safe-area-inset-bottom)',
				paddingLeft: 'env(safe-area-inset-left)',
				paddingRight: 'env(safe-area-inset-right)',
			}}
		>
			{children}
		</div>
	)
}
