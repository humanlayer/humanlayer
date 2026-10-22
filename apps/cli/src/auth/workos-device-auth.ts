export interface DeviceAuthResult {
	access_token: string
	refresh_token: string
	user: { id: string; email: string }
	organization_id: string
}

interface DeviceCodeResponse {
	device_code: string
	user_code: string
	verification_uri: string
	verification_uri_complete: string
	interval: number
	expires_in: number
}

/**
 * Request device codes from WorkOS.
 * WorkOS shows an org picker in the browser for multi-org users.
 */
export async function requestDeviceCodes(clientId: string): Promise<DeviceCodeResponse> {
	const resp = await fetch('https://api.workos.com/user_management/authorize/device', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientId }),
	})

	if (!resp.ok) {
		throw new Error(`WorkOS device auth request failed: ${resp.status} ${await resp.text()}`)
	}

	return (await resp.json()) as DeviceCodeResponse
}

/**
 * Poll WorkOS for token completion.
 * Blocks until the user completes authentication or the device code expires.
 */
export async function pollForToken(clientId: string, deviceCode: string, interval: number): Promise<DeviceAuthResult> {
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, interval * 1000))

		const resp = await fetch('https://api.workos.com/user_management/authenticate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: deviceCode,
				client_id: clientId,
			}),
		})

		if (resp.ok) {
			return (await resp.json()) as DeviceAuthResult
		}

		const error = (await resp.json().catch(() => ({ error: 'unknown' }))) as { error?: string }

		if (error.error === 'authorization_pending') {
			continue // User hasn't completed auth yet
		}

		if (error.error === 'slow_down') {
			interval += 1 // Back off
			continue
		}

		if (error.error === 'expired_token') {
			throw new Error('Device code expired. Please try again.')
		}

		throw new Error(`WorkOS authentication failed: ${error.error ?? resp.status}`)
	}
}
