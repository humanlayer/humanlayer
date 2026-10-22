import z from 'zod/v4'

function getDecodedCandidates(val: string): string[] {
	const candidates = [val]

	try {
		const decoded = decodeURIComponent(val)
		if (decoded !== val) {
			candidates.push(decoded)
		}
	} catch {
		// Invalid encoding is fine to pass through.
	}

	return candidates
}

/**
 * Check for dangerous characters in both raw and URL-decoded forms.
 * Returns true if the value contains traversal patterns.
 */
function containsTraversalPatterns(val: string): boolean {
	return getDecodedCandidates(val).some(
		(candidate) =>
			candidate.includes('/') || candidate.includes('\\') || candidate.includes('..') || candidate.includes('\0'),
	)
}

function containsDangerousSubpathPatterns(val: string): boolean {
	if (val.includes('\\') || val.includes('..') || val.includes('\0')) {
		return true
	}

	try {
		const decoded = decodeURIComponent(val)
		if (decoded !== val) {
			return (
				decoded.includes('\\') ||
				decoded.includes('..') ||
				decoded.includes('\0') ||
				decoded.split('/').length !== val.split('/').length
			)
		}
	} catch {
		// Invalid encoding is fine to pass through.
	}

	return false
}

function hasInvalidSubpathStructure(val: string): boolean {
	const hasInvalidSegments = (candidate: string) => {
		if (candidate.startsWith('/') || candidate.endsWith('/')) {
			return true
		}

		return candidate.split('/').some((segment) => segment.length === 0 || segment === '.')
	}

	if (hasInvalidSegments(val)) {
		return true
	}

	try {
		const decoded = decodeURIComponent(val)
		if (decoded !== val) {
			return hasInvalidSegments(decoded)
		}
	} catch {
		// Invalid encoding is fine to pass through.
	}

	return false
}

/**
 * Safe filename schema that rejects path traversal attempts.
 * Use this for flat artifact fileName inputs.
 */
export const safeFileNameSchema = z
	.string()
	.min(1)
	.max(255)
	.refine((val) => !containsTraversalPatterns(val), {
		message: 'Filename cannot contain path separators, traversal sequences, or null bytes',
	})

/**
 * Safe subpath schema that allows nested paths while rejecting traversal attempts.
 * Use this for artifact fileName inputs that should preserve subdirectories.
 */
export const safeSubpathSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine((val) => !containsDangerousSubpathPatterns(val), {
		message: 'Path contains traversal patterns',
	})
	.refine((val) => !hasInvalidSubpathStructure(val), {
		message: 'Path must be relative without empty segments or trailing slashes',
	})
