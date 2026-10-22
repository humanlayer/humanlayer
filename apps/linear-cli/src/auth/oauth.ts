import { createHash, randomBytes } from 'crypto'
import { execFile } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import process from 'node:process'
import { promisify } from 'node:util'

import chalk from 'chalk'

import type { TokenData } from './storage'

const execFileAsync = promisify(execFile)

const CLIENT_ID = '4266d82fa85e5a16aa1c62e4ce0b4086'
const CALLBACK_PORTS = [34567, 45678, 56789, 67890]
const SCOPES = 'read,write,issues:create,comments:create'
const AUTH_URL = 'https://linear.app/oauth/authorize'
const TOKEN_URL = 'https://api.linear.app/oauth/token'

// Spinner animation for OAuth flow
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function startSpinner(message: string): NodeJS.Timeout {
	let i = 0
	return setInterval(() => {
		const frame = spinnerFrames[i++ % spinnerFrames.length]
		process.stderr.write(`\r${chalk.yellow(frame)} ${message}`)
	}, 80)
}

function stopSpinner(interval: NodeJS.Timeout): void {
	clearInterval(interval)
	process.stderr.write('\r' + ' '.repeat(60) + '\r') // Clear the line
}

interface PKCEParams {
	codeVerifier: string
	codeChallenge: string
}

/**
 * Generate PKCE code verifier and SHA256 challenge
 */
export function generatePKCE(): PKCEParams {
	const codeVerifier = randomBytes(32).toString('base64url')
	const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
	return { codeVerifier, codeChallenge }
}

/**
 * Generate secure state parameter for CSRF protection
 */
export function generateState(): string {
	return randomBytes(16).toString('base64url')
}

/**
 * Build Linear authorization URL
 */
export function buildAuthorizationUrl(redirectUri: string, codeChallenge: string, state: string): string {
	const url = new URL(AUTH_URL)
	url.searchParams.set('client_id', CLIENT_ID)
	url.searchParams.set('redirect_uri', redirectUri)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', SCOPES)
	url.searchParams.set('code_challenge', codeChallenge)
	url.searchParams.set('code_challenge_method', 'S256')
	url.searchParams.set('state', state)
	return url.toString()
}

/**
 * Open URL in default browser (cross-platform)
 */
export async function openBrowser(url: string): Promise<void> {
	const platform = process.platform
	const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'

	try {
		await execFileAsync(command, [url])
	} catch {
		console.error(chalk.red('Failed to open browser automatically.'))
		console.log(chalk.yellow('Please open this URL manually:'))
		console.log(chalk.dim(url))
	}
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
	redirectUri: string,
): Promise<TokenData> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			redirect_uri: redirectUri,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
			grant_type: 'authorization_code',
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
	}

	const data = (await response.json()) as {
		access_token: string
		refresh_token: string
		expires_in: number
		token_type: string
		scope: string
	}

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		token_type: data.token_type,
		scope: data.scope,
	}
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
			client_id: CLIENT_ID,
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
	}

	const data = (await response.json()) as {
		access_token: string
		refresh_token: string
		expires_in: number
		token_type: string
		scope: string
	}

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		token_type: data.token_type,
		scope: data.scope,
	}
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Linear CLI - Authenticated</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="font-family: 'IBM Plex Mono', monospace; text-align: center; padding: 50px; background: #1e1e2e; min-height: 100vh; margin: 0; box-sizing: border-box;">
  <div style="max-width: 450px; margin: 0 auto; background: #313244; padding: 40px; border: 1px solid #6c7086;">
    <div style="font-size: 48px; margin-bottom: 16px; color: #a6e3a1;">✓</div>
    <h1 style="color: #a6e3a1; margin: 0 0 16px 0; font-weight: 500; font-size: 1.5rem;">Successfully authenticated!</h1>
    <p style="color: #9399b2; margin: 0; font-size: 0.9rem;">You can close this window and return to the terminal.</p>
    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #6c7086;">
      <span style="color: #cba6f7; font-size: 0.8rem;">linear-cli</span>
    </div>
  </div>
</body>
</html>`

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Linear CLI - Error</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="font-family: 'IBM Plex Mono', monospace; text-align: center; padding: 50px; background: #1e1e2e; min-height: 100vh; margin: 0; box-sizing: border-box;">
  <div style="max-width: 450px; margin: 0 auto; background: #313244; padding: 40px; border: 1px solid #6c7086;">
    <div style="font-size: 48px; margin-bottom: 16px; color: #f38ba8;">✗</div>
    <h1 style="color: #f38ba8; margin: 0 0 16px 0; font-weight: 500; font-size: 1.5rem;">Authentication failed</h1>
    <p style="color: #cdd6f4; margin: 0 0 8px 0; font-size: 0.9rem;">Error: ${message}</p>
    <p style="color: #9399b2; margin: 0; font-size: 0.85rem;">Please return to the terminal and try again.</p>
    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #6c7086;">
      <span style="color: #cba6f7; font-size: 0.8rem;">linear-cli</span>
    </div>
  </div>
</body>
</html>`

/**
 * Perform complete OAuth flow (restructured)
 */
export async function performOAuthFlowV2(): Promise<TokenData> {
	const { codeVerifier, codeChallenge } = generatePKCE()
	const state = generateState()

	// Find available port and start server
	let server: ReturnType<typeof Bun.serve> | null = null
	let selectedPort: number | null = null
	let resolveCallback: ((result: { code: string; state: string }) => void) | null = null
	let rejectCallback: ((error: Error) => void) | null = null

	const callbackPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
		resolveCallback = resolve
		rejectCallback = reject
	})

	for (const port of CALLBACK_PORTS) {
		try {
			server = Bun.serve({
				port,
				fetch(req) {
					const url = new URL(req.url)

					if (url.pathname === '/callback' || url.pathname === '/') {
						const code = url.searchParams.get('code')
						const receivedState = url.searchParams.get('state')
						const error = url.searchParams.get('error')
						const errorDescription = url.searchParams.get('error_description')

						if (error) {
							const message = errorDescription || error
							rejectCallback?.(new Error(message))
							return new Response(ERROR_HTML(message), {
								headers: { 'Content-Type': 'text/html' },
							})
						}

						if (!code || !receivedState) {
							const message = 'Missing code or state parameter'
							rejectCallback?.(new Error(message))
							return new Response(ERROR_HTML(message), {
								headers: { 'Content-Type': 'text/html' },
							})
						}

						if (receivedState !== state) {
							const message = 'State mismatch - possible CSRF attack'
							rejectCallback?.(new Error(message))
							return new Response(ERROR_HTML(message), {
								headers: { 'Content-Type': 'text/html' },
							})
						}

						resolveCallback?.({ code, state: receivedState })
						return new Response(SUCCESS_HTML, {
							headers: { 'Content-Type': 'text/html' },
						})
					}

					return new Response('Not found', { status: 404 })
				},
			})
			selectedPort = port
			break
		} catch {
			continue
		}
	}

	if (!server || !selectedPort) {
		throw new Error(`Could not start callback server. All ports are in use: ${CALLBACK_PORTS.join(', ')}`)
	}

	const redirectUri = `http://localhost:${selectedPort}/callback`
	const authUrl = buildAuthorizationUrl(redirectUri, codeChallenge, state)

	console.log(chalk.cyan('Opening browser for authentication...'))
	console.log(chalk.dim(`Callback URL: ${redirectUri}`))

	await openBrowser(authUrl)

	const spinner = startSpinner('Waiting for browser authentication...')

	// Set up timeout
	const timeoutMs = 60000 // 1 minute
	const timeoutId = setTimeout(() => {
		rejectCallback?.(new Error('OAuth flow timed out after 1 minute. Please try again.'))
	}, timeoutMs)

	// Set up Ctrl+C handler
	const cleanup = () => {
		stopSpinner(spinner)
		void server?.stop()
		console.log(chalk.yellow('\nAuthentication cancelled.'))
		process.exit(130) // Standard exit code for SIGINT
	}

	process.on('SIGINT', cleanup)

	try {
		const { code } = await callbackPromise
		clearTimeout(timeoutId)
		stopSpinner(spinner)

		console.log(chalk.cyan('Exchanging code for tokens...'))

		const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri)

		return tokens
	} catch (error) {
		stopSpinner(spinner)
		throw error
	} finally {
		;(process as EventEmitter).off('SIGINT', cleanup)
		void server.stop()
	}
}

// Export the working version
export { performOAuthFlowV2 as performOAuthFlow }
