export function normalizeOrganizationDomain(input: string): string {
	const value = input.trim()

	if (!/^https?:\/\//i.test(value)) {
		return value
	}

	try {
		return new URL(value).hostname
	} catch {
		return value.replace(/^https?:\/\//i, '')
	}
}
