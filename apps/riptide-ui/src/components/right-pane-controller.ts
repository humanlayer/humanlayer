export interface RightPaneController {
	expand: () => void
}

let activeController: RightPaneController | null = null

export function registerRightPaneController(controller: RightPaneController): () => void {
	activeController = controller
	return () => {
		if (activeController === controller) activeController = null
	}
}

export function getRightPaneController(): RightPaneController | null {
	return activeController
}
