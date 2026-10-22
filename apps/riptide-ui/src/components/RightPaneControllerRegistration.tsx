import { registerRightPaneController } from '@/components/right-pane-controller'
import { useMountEffect } from '@/hooks/useMountEffect'

export function RightPaneControllerRegistration({ expand }: { expand: () => void }) {
	useMountEffect(() => registerRightPaneController({ expand }))
	return null
}
