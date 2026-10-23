export const normalizeWorkspaceRelativePath = (value: string): string => value.replaceAll('\\', '/')

export const isSafeWorkspaceRelativePath = (value: string): boolean => {
	const normalized = normalizeWorkspaceRelativePath(value)
	return (
		normalized.length > 0 &&
		!normalized.startsWith('/') &&
		!normalized.startsWith('~/') &&
		normalized !== '~' &&
		!/^[A-Za-z]:\//.test(normalized) &&
		!normalized.split('/').includes('..')
	)
}

export const workspacePathHasGlobMagic = (value: string): boolean => /[*?[]/.test(value)
