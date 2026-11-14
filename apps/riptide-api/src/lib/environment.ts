/**
 * Require an environment variable to be set, with optional default value.
 * @param name Environment variable name
 * @param defaultValue Optional default value if not set
 * @returns The environment variable value
 */
export function requireEnvironment(name: string, defaultValue?: string): string {
	const value = process.env[name] ?? defaultValue
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}
	return value
}

export function getStripeSecretKey(): string {
	return requireEnvironment('STRIPE_SECRET_KEY')
}

export function getStripeWebhookSecret(): string {
	return requireEnvironment('STRIPE_WEBHOOK_SECRET')
}

export function getWorkosWebhookSecret(): string {
	return requireEnvironment('WORKOS_WEBHOOK_SECRET')
}

export function getResendApiKey(): string {
	return requireEnvironment('RESEND_API_KEY')
}

export function getResendWebhookSecret(): string {
	return requireEnvironment('RESEND_WEBHOOK_SECRET')
}

export function getKvUrl(): string {
	return requireEnvironment('KV_URL')
}

export function getStripePricePro(): string {
	const value = requireEnvironment('STRIPE_PRICE_PRO').trim()
	if (!value.startsWith('price_')) {
		throw new Error('STRIPE_PRICE_PRO must be a Stripe price ID beginning with price_')
	}
	return value
}

export function getStripePriceStarter(): string {
	const value = requireEnvironment('STRIPE_PRICE_STARTER').trim()
	if (!value.startsWith('price_')) {
		throw new Error('STRIPE_PRICE_STARTER must be a Stripe price ID beginning with price_')
	}
	return value
}

export function isBillingEnforcementEnabled(): boolean {
	return requireEnvironment('IS_BILLING_ENFORCEMENT_ENABLED') === 'true'
}

/**
 * Whether new organization creation is blocked for this environment. HumanLayer
 * Cloud blocks it everywhere while it shuts down. Controlled by the
 * BLOCK_NEW_ORG_CREATION env var.
 */
export function isNewOrgCreationBlocked(): boolean {
	return process.env.BLOCK_NEW_ORG_CREATION === 'true'
}

/**
 * Message shown when new organization creation is blocked. Generic across
 * environments: HumanLayer Cloud is shutting down as HumanLayer joins Factory.
 */
export const BLOCK_NEW_ORG_CREATION_MESSAGE =
	'HumanLayer Cloud is shutting down as HumanLayer joins Factory (https://humanlayer.com/blog/humanlayer-joins-factory), so it no longer accepts new organizations. If your team already has an org, ask a teammate for an invite. To keep using HumanLayer, self-host the open source version: https://github.com/humanlayer/humanlayer'

/**
 * Check if the current environment is a dev environment (local or devcloud).
 * Uses STAGE env var which defaults to 'local' when absent.
 */
export function isDevEnvironment(): boolean {
	const stage = process.env.STAGE ?? 'local'
	return stage === 'local' || stage === 'dev'
}

/**
 * Check if an email address belongs to the humanlayer.dev domain.
 */
export function isHumanlayerEmailDomain(email: string): boolean {
	const domain = email.split('@')[1]
	return domain?.toLowerCase() === 'humanlayer.dev'
}

/**
 * Check if an email belongs to HumanLayer staff (humanlayer.dev or
 * humanlayer.com). Staff are allowed to create orgs even when new org
 * creation is otherwise blocked for the environment.
 */
export function isHumanlayerStaffEmail(email: string): boolean {
	const domain = email.split('@')[1]?.toLowerCase()
	return domain === 'humanlayer.dev' || domain === 'humanlayer.com'
}
