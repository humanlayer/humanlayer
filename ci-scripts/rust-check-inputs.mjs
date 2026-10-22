import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Only skip known non-Rust source changes. New file types and infrastructure
// default to a full check, rather than silently missing new build inputs.
export function needsRustCheck(paths) {
	if (paths.length === 0) return true
	return paths.some((path) => {
		// cargo check/test do not invoke Tauri's beforeBuildCommand; the daemon
		// resource is a placeholder. UI/daemon TS is not a Rust compilation input.
		// Rust tests do include a fixture from packages/schemas outside the crate.
		if (/^(apps\/riptide-native|packages\/schemas)\//.test(path)) return true
		if (path.includes('/.cargo/') || path.includes('/../')) return true
		return !/^(apps|packages|contracts)\/.+\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|json|md|mdx)$/.test(path)
	})
}

export function changedPaths(output) {
	if (!output.endsWith('\0')) throw new Error('Missing or incomplete git diff output')
	return output.slice(0, -1).split('\0')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	let required = true
	try {
		const { PR_BASE_SHA: base, PR_HEAD_SHA: head } = process.env
		if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? ''))) throw new Error('Invalid PR SHAs')
		// No rename detection: evaluate both the old and new path for moves/deletions.
		const output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'], {
			encoding: 'utf8',
		})
		required = needsRustCheck(changedPaths(output))
	} catch (error) {
		console.warn(`Rust input detection uncertain; running full Rust checks: ${error.message}`)
	}
	appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`)
}
