import * as stripe from '@humanlayer/pulumi-stripe'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

const config = new pulumi.Config()
const env = pulumi.getStack()
const mode = config.require('mode')
const billingEnforcementEnabled = config.requireBoolean('billingEnforcementEnabled')
const stripeSecretKey = config.requireSecret('stripeSecretKey')
const devSecretResourceOptions = env === 'dev' ? { deleteBeforeReplace: true } : undefined
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>

const provider = new stripe.Provider('stripe-provider', {
	apiKey: stripeSecretKey,
})

const priceResourceOptions = {
	provider,
	deleteBeforeReplace: true,
} as const

const lookupKeySuffix = new random.RandomId('lookup-key-suffix', {
	byteLength: 4,
	keepers: {
		changedAt: '2026-04-30',
	},
})

const proPriceLookupKey = pulumi.interpolate`humanlayer-pro-${env}-${lookupKeySuffix.hex}`
const starterPriceLookupKey = pulumi.interpolate`humanlayer-starter-${env}-${lookupKeySuffix.hex}`
const enterprisePriceLookupKey = pulumi.interpolate`humanlayer-enterprise-${env}-${lookupKeySuffix.hex}`

const monthlyLicensedRecurring = {
	interval: 'month',
	usageType: 'licensed',
} as const

const secretKeySecret = new aws.secretsmanager.Secret(
	'stripe-secret-key',
	{
		name: `stripe/${env}/secret-key`,
		recoveryWindowInDays: env === 'dev' ? 0 : undefined,
	},
	devSecretResourceOptions,
)

const secretKeySecretVersion = new aws.secretsmanager.SecretVersion('stripe-secret-key-value', {
	secretId: secretKeySecret.id,
	secretString: stripeSecretKey,
})

const trackedWebhookEvents = [
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.paused',
	'customer.subscription.resumed',
	'customer.subscription.pending_update_applied',
	'customer.subscription.pending_update_expired',
	'customer.subscription.trial_will_end',
	'invoice.paid',
	'invoice.payment_failed',
	'invoice.payment_action_required',
	'invoice.upcoming',
	'invoice.marked_uncollectible',
	'invoice.payment_succeeded',
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'payment_intent.canceled',
]

const webhookEndpoint = new stripe.WebhookEndpoint(
	'riptide-api-webhook-endpoint',
	{
		description: `Riptide API billing webhook (${env})`,
		enabledEvents: trackedWebhookEvents,
		metadata: {
			env,
			mode,
			service: 'riptide-api',
		},
		url: pulumi.interpolate`https://riptide-api.${domainSuffix}/webhooks/stripe`,
	},
	{ provider },
)

const webhookSecretSecret = new aws.secretsmanager.Secret(
	'stripe-webhook-secret',
	{
		name: `stripe/${env}/webhook-secret`,
		recoveryWindowInDays: env === 'dev' ? 0 : undefined,
	},
	devSecretResourceOptions,
)

const webhookSecretSecretVersion = new aws.secretsmanager.SecretVersion('stripe-webhook-secret-value', {
	secretId: webhookSecretSecret.id,
	secretString: webhookEndpoint.secret,
})

const proProduct = new stripe.Product(
	'pro-product',
	{
		name: 'HumanLayer Pro',
		description: 'Per-seat HumanLayer subscription for self-serve organizations',
		metadata: {
			env,
			mode,
			tier: 'pro',
		},
	},
	{ provider },
)

const proPrice = new stripe.Price(
	'pro-price',
	{
		currency: 'usd',
		lookupKey: proPriceLookupKey,
		metadata: {
			env,
			mode,
			tier: 'pro',
		},
		nickname: `HumanLayer Pro (${env})`,
		product: proProduct.id,
		recurring: monthlyLicensedRecurring,
		unitAmount: 10000,
	},
	priceResourceOptions,
)

const starterProduct = new stripe.Product(
	'starter-product',
	{
		name: 'HumanLayer Starter',
		description: 'Free HumanLayer subscription for small self-serve organizations',
		metadata: {
			env,
			mode,
			tier: 'starter',
		},
	},
	{ provider },
)

const starterPrice = new stripe.Price(
	'starter-price',
	{
		currency: 'usd',
		lookupKey: starterPriceLookupKey,
		metadata: {
			env,
			mode,
			tier: 'starter',
		},
		nickname: `HumanLayer Starter (${env})`,
		product: starterProduct.id,
		recurring: monthlyLicensedRecurring,
		unitAmount: 0,
	},
	priceResourceOptions,
)

const enterpriseProduct = new stripe.Product(
	'enterprise-product',
	{
		name: 'HumanLayer Enterprise',
		description: 'Manual-invoicing HumanLayer subscription for enterprise organizations',
		metadata: {
			env,
			mode,
			tier: 'enterprise',
		},
	},
	{ provider },
)

const enterprisePrice = new stripe.Price(
	'enterprise-price',
	{
		currency: 'usd',
		lookupKey: enterprisePriceLookupKey,
		metadata: {
			env,
			mode,
			tier: 'enterprise',
			billing: 'send_invoice',
		},
		nickname: `HumanLayer Enterprise (${env})`,
		product: enterpriseProduct.id,
		recurring: monthlyLicensedRecurring,
		unitAmount: 0,
	},
	priceResourceOptions,
)

const ycCoupon = new stripe.Coupon(
	'yc-coupon',
	{
		duration: 'repeating',
		durationInMonths: 12,
		metadata: {
			env,
			mode,
			program: 'yc',
		},
		name: `YC discount (${env})`,
		percentOff: 50,
	},
	{ provider },
)

export const stripeMode = mode
export { billingEnforcementEnabled }
export const secretKeySecretArn = secretKeySecret.arn
export const secretKeySecretValueArn = secretKeySecretVersion.arn
export const webhookEndpointId = webhookEndpoint.id
export const webhookEndpointUrl = webhookEndpoint.url
export const webhookSecretSecretArn = webhookSecretSecret.arn
export const webhookSecretSecretValueArn = webhookSecretSecretVersion.arn
export const proProductId = proProduct.id
export const proPriceId = proPrice.id
export const proPriceLookupKeyOutput = proPriceLookupKey
export const starterProductId = starterProduct.id
export const starterPriceId = starterPrice.id
export const starterPriceLookupKeyOutput = starterPriceLookupKey
export const enterpriseProductId = enterpriseProduct.id
export const enterprisePriceId = enterprisePrice.id
export const enterprisePriceLookupKeyOutput = enterprisePriceLookupKey
export const ycCouponId = ycCoupon.id
