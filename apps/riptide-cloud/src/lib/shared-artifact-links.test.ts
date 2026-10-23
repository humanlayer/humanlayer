import { afterEach, expect, test, vi } from 'vitest'

async function build(origin: string | undefined, artifactId = 'artifact-id', shareKey = 'share-key') {
	vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', origin as string)
	vi.resetModules()
	const { sharedArtifactAppUrl } = await import('./shared-artifact-links')
	return sharedArtifactAppUrl(artifactId, shareKey)
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

test('redirects legacy shared links to the app origin with the capability intact', async () => {
	await expect(build('https://app.dev.codelayer.gg')).resolves.toBe(
		'https://app.dev.codelayer.gg/shared/artifacts/artifact-id?key=share-key',
	)
})

test('uses the local app origin when no deployed origin is configured', async () => {
	await expect(build(undefined)).resolves.toBe('http://localhost:3000/shared/artifacts/artifact-id?key=share-key')
})
