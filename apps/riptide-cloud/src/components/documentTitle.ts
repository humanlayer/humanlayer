const PRODUCT_NAME = 'HumanLayer'

export function formatDocumentTitle(resourceName?: string | null, defaultTitle = 'HumanLayer Cloud'): string {
	return resourceName ? `${resourceName} | ${PRODUCT_NAME}` : defaultTitle
}
