import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { net, protocol } from 'electron'

import { Sentry } from './instrument'

export function registerPackagedRendererScheme(scheme: string): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
			},
		},
	])
}

function isInsideDirectory(directory: string, candidate: string): boolean {
	const relativePath = relative(directory, candidate)
	return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function rendererFileForRequest(rendererDirectory: string, scheme: string, requestUrl: string): Promise<string> {
	const url = new URL(requestUrl)
	if (url.protocol !== `${scheme}:` || url.host !== 'app') {
		return resolve(rendererDirectory, 'index.html')
	}

	const pathname = decodeURIComponent(url.pathname)
	const requestedFile = resolve(rendererDirectory, `.${pathname}`)
	if (isInsideDirectory(rendererDirectory, requestedFile)) {
		try {
			if ((await stat(requestedFile)).isFile()) return requestedFile
		} catch {
			// Client-side routes are served by the SPA entry point.
		}
	}
	return resolve(rendererDirectory, 'index.html')
}

export function installPackagedRendererProtocol(scheme: string, rendererDirectory: string): void {
	protocol.handle(scheme, async (request) => {
		try {
			const filePath = await rendererFileForRequest(rendererDirectory, scheme, request.url)
			return net.fetch(pathToFileURL(filePath).toString())
		} catch (error) {
			console.error('Packaged renderer request failed', { requestUrl: request.url, error })
			Sentry.captureException(error, {
				tags: { operation: 'packaged_renderer_request' },
				extra: { request_url: request.url },
			})
			return new Response('Unable to load renderer', { status: 500 })
		}
	})
}
