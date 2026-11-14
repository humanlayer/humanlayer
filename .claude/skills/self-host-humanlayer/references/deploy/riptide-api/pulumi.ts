import { execSync } from 'node:child_process'

import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import * as resend from '@humanlayer/pulumi-resend'
import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import { local } from '@pulumi/command'
import * as dockerBuild from '@pulumi/docker-build'
import * as pulumi from '@pulumi/pulumi'

// Configuration
interface FargateConfig {
	cpu: number
	memory: number
	desiredCount: number
}

interface AutoScalingConfig {
	enabled: boolean
	minCapacity?: number
	maxCapacity?: number
	cpuTarget?: number
	memoryTarget?: number
}

interface DbPoolConfig {
	max: number
	idleTimeout: number
	maxLifetime: number
	connectTimeout: number
}

const config = new pulumi.Config()
const fargate = config.requireObject<FargateConfig>('fargate')
const autoScaling = config.requireObject<AutoScalingConfig>('autoScaling')
const dbPool = config.requireObject<DbPoolConfig>('dbPool')
const fargateArchitecture = {
	imagePlatform: dockerBuild.Platform.Linux_arm64,
	runtimePlatform: {
		cpuArchitecture: 'ARM64',
		operatingSystemFamily: 'LINUX',
	},
} as const
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')
const sentryAuthToken = config.requireSecret('sentryAuthToken')
const posthogKey = config.require('posthogKey')
const workosApiKey = config.requireSecret('workosApiKey')
const workosWebhookSecret = config.requireSecret('workosWebhookSecret')
const workosClientId = config.require('workosClientId')
const anthropicApiKey = config.requireSecret('anthropicApiKey')
const openaiApiKey = config.requireSecret('openaiApiKey')
const exaApiKey = config.requireSecret('exaApiKey')
const context7ApiKey = config.requireSecret('context7ApiKey')
const jiraClientId = config.require('jiraClientId')
const jiraClientSecret = config.requireSecret('jiraClientSecret')
const linearClientId = config.require('linearClientId')
const linearClientSecret = config.requireSecret('linearClientSecret')
const slackClientId = config.require('slackClientId')
const slackClientSecret = config.requireSecret('slackClientSecret')
const slackAppId = config.require('slackAppId')
const slackSigningSecret = config.requireSecret('slackSigningSecret')
const githubAppId = config.require('githubAppId')
const githubAppClientId = config.require('githubAppClientId')
const githubAppSlug = config.require('githubAppSlug')
const githubAppPrivateKey = config.requireSecret('githubAppPrivateKey')
const githubAppWebhookSecret = config.requireSecret('githubAppWebhookSecret')
const resendApiKey = config.requireSecret('resendApiKey')
const resendFromEmail = config.require('resendFromEmail')
const blockNewOrgCreation = config.getBoolean('blockNewOrgCreation') ?? false
const onboardingCampaignEnabled = config.getBoolean('onboardingCampaignEnabled') ?? false

const env = pulumi.getStack()
const electronRendererOrigin = {
	dev: 'humanlayer-electron-dev://app',
	beta: 'humanlayer-electron-beta://app',
	prod: 'humanlayer-electron://app',
}[env]

if (!electronRendererOrigin) {
	throw new Error(`No Electron renderer origin configured for stack: ${env}`)
}

const resendProvider = new resend.Provider('resend-provider', {
	apiKey: resendApiKey,
})

const resendWebhookEvents = [
	'email.sent',
	'email.delivered',
	'email.bounced',
	'email.complained',
	'email.opened',
	'email.clicked',
	'email.failed',
	'email.delivery_delayed',
	'email.scheduled',
	'email.received',
	'email.suppressed',
	'domain.created',
	'domain.updated',
	'domain.deleted',
	'contact.created',
	'contact.updated',
	'contact.deleted',
]

const gitSha = process.env.HUMANLAYER_SHA ?? execSync('git rev-parse HEAD', { cwd: '../../humanlayer' }).toString().trim()

// Get the ELB service account for access logs
const elbServiceAccount = aws.elb.getServiceAccountOutput()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const rdsStack = new pulumi.StackReference(`humanlayer/rds-postgres/${env}`)
const daemonTokenKeysStack = new pulumi.StackReference(`humanlayer/daemon-token-keys/${env}`)
const stripeStack = new pulumi.StackReference(`humanlayer/stripe/${env}`)
const memorydbStack = new pulumi.StackReference(`humanlayer/memorydb/${env}`)
const rustDurableStreamsStack = new pulumi.StackReference(`humanlayer/rust-durable-streams/${env}`)
const resendStack = new pulumi.StackReference('humanlayer/resend/prod')

// Import from core stack
const ecsClusterArn = coreStack.requireOutput('ecsClusterArn')
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const publicSubnetIds = coreStack.requireOutput('publicSubnetIds') as pulumi.Output<string[]>
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>
const apiOrigin = pulumi.interpolate`https://riptide-api.${domainSuffix}`

// Import from RDS stack
const connectionUrlSecretValueArn = rdsStack.requireOutput('connectionUrlSecretValueArn') as pulumi.Output<string>
const readReplicaConnectionUrlSecretValueArn = rdsStack.requireOutput(
	'readReplicaConnectionUrlSecretValueArn',
) as pulumi.Output<string>
const rdsSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>

// Import from Stripe stack
const stripeSecretKeySecretValueArn = stripeStack.requireOutput('secretKeySecretValueArn') as pulumi.Output<string>
const stripeWebhookSecretSecretValueArn = stripeStack.requireOutput(
	'webhookSecretSecretValueArn',
) as pulumi.Output<string>
const stripeProPriceId = stripeStack.requireOutput('proPriceId') as pulumi.Output<string>
const stripeStarterPriceId = stripeStack.requireOutput('starterPriceId') as pulumi.Output<string>
const stripeEnterprisePriceId = stripeStack.requireOutput('enterprisePriceId') as pulumi.Output<string>
const billingEnforcementEnabled = stripeStack.requireOutput('billingEnforcementEnabled') as pulumi.Output<boolean>

// Import from Resend stack
const productUsersSegmentId = resendStack.requireOutput('productUsersSegmentId') as pulumi.Output<string>

// Import from MemoryDB stack
const memorydbConnectionUrlSecretValueArn = memorydbStack.requireOutput(
	'connectionUrlSecretValueArn',
) as pulumi.Output<string>
const memorydbSecurityGroupId = memorydbStack.requireOutput('securityGroupId') as pulumi.Output<string>
const memorydbPort = memorydbStack.requireOutput('port') as pulumi.Output<number>

// Import from Rust Durable Streams stack
const durableStreamsUrl = rustDurableStreamsStack.requireOutput('durableStreamsUrl') as pulumi.Output<string>
const durableStreamsAlbSecurityGroupId = rustDurableStreamsStack.requireOutput(
	'albSecurityGroupId',
) as pulumi.Output<string>

// Import from daemon-token-keys stack
const daemonTokenPublicKeySecretValueArn = daemonTokenKeysStack.requireOutput(
	'publicKeySecretValueArn',
) as pulumi.Output<string>
const daemonTokenPrivateKeySecretValueArn = daemonTokenKeysStack.requireOutput(
	'privateKeySecretValueArn',
) as pulumi.Output<string>

// --- ECR Repository ---
const ecrRepo = new awsx.ecr.Repository('api-repo', {
	forceDelete: true,
	lifecyclePolicy: {
		rules: [
			{
				description: 'Expire untagged images after 30 days',
				tagStatus: 'untagged',
				maximumAgeLimit: 30,
			},
			{
				description: 'Keep last 100 images',
				tagStatus: 'any',
				maximumNumberOfImages: 100,
			},
		],
	},
})

// --- ECR Image (build from Dockerfile) ---
const ecrAuthToken = aws.ecr.getAuthorizationTokenOutput()
const image = new dockerBuild.Image('api-image', {
	context: { location: '../../humanlayer' },
	dockerfile: { location: '../../humanlayer/apps/riptide-api/Dockerfile' },
	platforms: [fargateArchitecture.imagePlatform],
	buildArgs: {
		SENTRY_RELEASE: gitSha,
		SENTRY_ENVIRONMENT: sentryEnvironment,
		SENTRY_ORG: 'humanlayer-00',
	},
	secrets: {
		SENTRY_AUTH_TOKEN: sentryAuthToken,
	},
	push: true,
	registries: [
		{
			address: ecrRepo.url,
			username: ecrAuthToken.userName,
			password: ecrAuthToken.password,
		},
	],
	tags: [pulumi.interpolate`${ecrRepo.url}:${gitSha}`],
})

// --- S3 bucket for ALB access logs ---
const albLogsBucket = new aws.s3.Bucket('api-alb-logs', {
	forceDestroy: true,
})

const _albLogsBucketPolicy = new aws.s3.BucketPolicy('api-alb-logs-policy', {
	bucket: albLogsBucket.id,
	policy: pulumi.all([albLogsBucket.arn, elbServiceAccount.arn]).apply(([bucketArn, elbArn]) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Principal: { AWS: elbArn },
					Action: 's3:PutObject',
					Resource: `${bucketArn}/*`,
				},
				denyInsecureTransportStatement(bucketArn),
			],
		}),
	),
})

// --- S3 bucket for artifact uploads ---
const artifactsBucket = new aws.s3.Bucket('riptide-artifacts', {
	forceDestroy: false,
})

const _artifactsBucketVersioning = new aws.s3.BucketVersioningV2('riptide-artifacts-versioning', {
	bucket: artifactsBucket.id,
	versioningConfiguration: {
		status: 'Enabled',
	},
})

const _artifactsBucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock('riptide-artifacts-public-access-block', {
	bucket: artifactsBucket.id,
	blockPublicAcls: true,
	blockPublicPolicy: true,
	ignorePublicAcls: true,
	restrictPublicBuckets: true,
})

const _artifactsBucketCors = new aws.s3.BucketCorsConfigurationV2('riptide-artifacts-cors', {
	bucket: artifactsBucket.id,
	corsRules: [
		{
			allowedHeaders: ['*'],
			allowedMethods: ['PUT', 'GET'],
			allowedOrigins: [
				pulumi.interpolate`https://app.${domainSuffix}`,
				pulumi.interpolate`https://cloud.${domainSuffix}`,
				'http://localhost:*',
				'https://localhost:*',
				'tauri://localhost',
				'https://tauri.localhost',
				electronRendererOrigin,
			],
			maxAgeSeconds: 3600,
		},
	],
})

const _artifactsBucketPolicy = new aws.s3.BucketPolicy('riptide-artifacts-policy', {
	bucket: artifactsBucket.id,
	policy: artifactsBucket.arn.apply((bucketArn) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [denyInsecureTransportStatement(bucketArn)],
		}),
	),
})

// --- Public Application Load Balancer ---
const loadBalancer = new awsx.lb.ApplicationLoadBalancer('api-alb', {
	internal: false,
	subnetIds: publicSubnetIds,
	accessLogs: {
		enabled: true,
		bucket: albLogsBucket.id,
		prefix: 'api-alb',
	},
	defaultTargetGroup: {
		port: 8700,
		protocol: 'HTTP',
		healthCheck: {
			enabled: true,
			path: '/',
			protocol: 'HTTP',
			matcher: '200-299',
		},
	},
	listeners: [
		{
			port: 443,
			protocol: 'HTTPS',
			certificateArn: validatedCertificateArn,
		},
		{
			port: 80,
			protocol: 'HTTP',
			defaultActions: [
				{
					type: 'redirect',
					redirect: {
						port: '443',
						protocol: 'HTTPS',
						statusCode: 'HTTP_301',
					},
				},
			],
		},
	],
})

// --- Route53 A-alias record: riptide-api.{domainSuffix} → ALB ---
const _dnsRecord = new aws.route53.Record('api-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`riptide-api.${domainSuffix}`,
	type: 'A',
	aliases: [
		{
			name: loadBalancer.loadBalancer.dnsName,
			zoneId: loadBalancer.loadBalancer.zoneId,
			evaluateTargetHealth: true,
		},
	],
})

// --- ECS Security Group ---
const apiSecurityGroup = new aws.ec2.SecurityGroup('api-ecs-sg', {
	description: 'Allows connections from the load balancer to the riptide API',
	vpcId,
	ingress: [
		{
			protocol: 'tcp',
			fromPort: 8700,
			toPort: 8700,
			securityGroups: loadBalancer.loadBalancer.securityGroups,
		},
	],
	egress: [
		{
			protocol: '-1',
			fromPort: 0,
			toPort: 0,
			cidrBlocks: ['0.0.0.0/0'],
		},
	],
})

// --- Security Group Rule: Allow API to access RDS ---
const rdsIngressFromApi = new aws.ec2.SecurityGroupRule('api-postgres-access-rule', {
	type: 'ingress',
	description: 'Allow Riptide API to connect to postgres',
	sourceSecurityGroupId: apiSecurityGroup.id,
	securityGroupId: rdsSecurityGroupId,
	fromPort: 5432,
	toPort: 5432,
	protocol: 'tcp',
})

const memorydbIngressFromApi = new aws.ec2.SecurityGroupRule('api-memorydb-access-rule', {
	type: 'ingress',
	description: 'Allow Riptide API to connect to MemoryDB',
	sourceSecurityGroupId: apiSecurityGroup.id,
	securityGroupId: memorydbSecurityGroupId,
	fromPort: memorydbPort,
	toPort: memorydbPort,
	protocol: 'tcp',
})

const durableStreamsIngressFromApi = new aws.ec2.SecurityGroupRule('api-durable-streams-access-rule', {
	type: 'ingress',
	description: 'Allow Riptide API to reach Rust Durable Streams ALB',
	sourceSecurityGroupId: apiSecurityGroup.id,
	securityGroupId: durableStreamsAlbSecurityGroupId,
	fromPort: 443,
	toPort: 443,
	protocol: 'tcp',
})

// --- Secrets Manager entries from Pulumi encrypted config ---
const workosApiKeySecret = new aws.secretsmanager.Secret(
	'api-workos-api-key',
	{
		name: `riptide-api/${env}/workos-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const workosApiKeySecretVersion = new aws.secretsmanager.SecretVersion('api-workos-api-key-value', {
	secretId: workosApiKeySecret.id,
	secretString: workosApiKey,
})

const workosWebhookSecretSecret = new aws.secretsmanager.Secret(
	'api-workos-webhook-secret',
	{
		name: `riptide-api/${env}/workos-webhook-secret`,
	},
	{ deleteBeforeReplace: true },
)
const workosWebhookSecretSecretVersion = new aws.secretsmanager.SecretVersion('api-workos-webhook-secret-value', {
	secretId: workosWebhookSecretSecret.id,
	secretString: workosWebhookSecret,
})

const anthropicApiKeySecret = new aws.secretsmanager.Secret(
	'api-anthropic-api-key',
	{
		name: `riptide-api/${env}/anthropic-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const anthropicApiKeySecretVersion = new aws.secretsmanager.SecretVersion('api-anthropic-api-key-value', {
	secretId: anthropicApiKeySecret.id,
	secretString: anthropicApiKey,
})

const openaiApiKeySecret = new aws.secretsmanager.Secret(
	'api-openai-api-key',
	{
		name: `riptide-api/${env}/openai-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const openaiApiKeySecretVersion = new aws.secretsmanager.SecretVersion('api-openai-api-key-value', {
	secretId: openaiApiKeySecret.id,
	secretString: openaiApiKey,
})

const exaApiKeySecret = new aws.secretsmanager.Secret(
	'api-exa-api-key',
	{
		name: `riptide-api/${env}/exa-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const exaApiKeySecretVersion = new aws.secretsmanager.SecretVersion('api-exa-api-key-value', {
	secretId: exaApiKeySecret.id,
	secretString: exaApiKey,
})

const context7ApiKeySecret = new aws.secretsmanager.Secret(
	'api-context7-api-key',
	{
		name: `riptide-api/${env}/context7-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const context7ApiKeySecretVersion = new aws.secretsmanager.SecretVersion('api-context7-api-key-value', {
	secretId: context7ApiKeySecret.id,
	secretString: context7ApiKey,
})

const jiraClientSecretSecret = new aws.secretsmanager.Secret(
	'api-jira-client-secret',
	{ name: `riptide-api/${env}/jira-client-secret` },
	{ deleteBeforeReplace: true },
)
const jiraClientSecretSecretVersion = new aws.secretsmanager.SecretVersion('api-jira-client-secret-value', {
	secretId: jiraClientSecretSecret.id,
	secretString: jiraClientSecret,
})

const linearClientSecretSecret = new aws.secretsmanager.Secret(
	'api-linear-client-secret',
	{ name: `riptide-api/${env}/linear-client-secret` },
	{ deleteBeforeReplace: true },
)
const linearClientSecretSecretVersion = new aws.secretsmanager.SecretVersion('api-linear-client-secret-value', {
	secretId: linearClientSecretSecret.id,
	secretString: linearClientSecret,
})

const slackClientSecretSecret = new aws.secretsmanager.Secret(
	'api-slack-client-secret',
	{ name: `riptide-api/${env}/slack-client-secret` },
	{ deleteBeforeReplace: true },
)
const slackClientSecretSecretVersion = new aws.secretsmanager.SecretVersion('api-slack-client-secret-value', {
	secretId: slackClientSecretSecret.id,
	secretString: slackClientSecret,
})

const slackSigningSecretSecret = new aws.secretsmanager.Secret(
	'api-slack-signing-secret',
	{ name: `riptide-api/${env}/slack-signing-secret` },
	{ deleteBeforeReplace: true },
)
const slackSigningSecretSecretVersion = new aws.secretsmanager.SecretVersion('api-slack-signing-secret-value', {
	secretId: slackSigningSecretSecret.id,
	secretString: slackSigningSecret,
})

const githubAppPrivateKeySecret = new aws.secretsmanager.Secret(
	'api-github-app-private-key',
	{ name: `riptide-api/${env}/github-app-private-key` },
	{ deleteBeforeReplace: true },
)
const githubAppPrivateKeySecretVersion = new aws.secretsmanager.SecretVersion('api-github-app-private-key-value', {
	secretId: githubAppPrivateKeySecret.id,
	secretString: githubAppPrivateKey,
})

const githubAppWebhookSecretSecret = new aws.secretsmanager.Secret(
	'api-github-app-webhook-secret',
	{ name: `riptide-api/${env}/github-app-webhook-secret` },
	{ deleteBeforeReplace: true },
)
const githubAppWebhookSecretSecretVersion = new aws.secretsmanager.SecretVersion(
	'api-github-app-webhook-secret-value',
	{
		secretId: githubAppWebhookSecretSecret.id,
		secretString: githubAppWebhookSecret,
	},
)

const resendApiKeyResource = new resend.ApiKey(
	'resend-api-key',
	{
		name: `riptide-api-${env}`,
		permission: 'full_access',
	},
	{ provider: resendProvider },
)

const resendWebhook = new resend.Webhook(
	'resend-webhook',
	{
		endpoint: pulumi.interpolate`https://riptide-api.${domainSuffix}/webhooks/resend`,
		events: resendWebhookEvents,
	},
	{ provider: resendProvider },
)

const resendApiKeySecret = new aws.secretsmanager.Secret(
	'resend-api-key-secret',
	{
		name: `resend/${env}/api-key`,
		recoveryWindowInDays: env === 'dev' ? 0 : 30,
	},
	env === 'dev' ? { deleteBeforeReplace: true } : {},
)

const resendApiKeySecretVersion = new aws.secretsmanager.SecretVersion('resend-api-key-secret-value', {
	secretId: resendApiKeySecret.id,
	secretString: resendApiKeyResource.token,
})

const resendWebhookSecret = new aws.secretsmanager.Secret(
	'resend-webhook-secret',
	{
		name: `resend/${env}/webhook-secret`,
		recoveryWindowInDays: env === 'dev' ? 0 : 30,
	},
	env === 'dev' ? { deleteBeforeReplace: true } : {},
)

const resendWebhookSecretVersion = new aws.secretsmanager.SecretVersion('resend-webhook-secret-value', {
	secretId: resendWebhookSecret.id,
	secretString: resendWebhook.signingSecret,
})

// --- Fargate Service ---
const service = new awsx.ecs.FargateService(
	'riptide-api',
	{
		cluster: ecsClusterArn,
		desiredCount: fargate.desiredCount,
		enableExecuteCommand: true,
		deploymentCircuitBreaker: {
			enable: true,
			rollback: true,
		},
		taskDefinitionArgs: {
			runtimePlatform: fargateArchitecture.runtimePlatform,
			logGroup: {
				args: {
					retentionInDays: 365,
				},
			},
			family: `riptide-api-${env}`,
			skipDestroy: true,
			container: {
				name: 'riptide-api',
				image: image.ref,
				cpu: fargate.cpu,
				memory: fargate.memory,
				essential: true,
				portMappings: [
					{
						containerPort: 8700,
						hostPort: 8700,
						targetGroup: loadBalancer.defaultTargetGroup,
					},
				],
				environment: [
					{ name: 'NODE_OPTIONS', value: `--max-old-space-size=${Math.floor(fargate.memory * 0.75)}` },
					{ name: 'PORT', value: '8700' },
					{ name: 'NODE_ENV', value: 'production' },
					{ name: 'STAGE', value: env },
					{ name: 'REDIS_CLIENT_MODE', value: 'cluster' },
					{
						name: 'IS_BILLING_ENFORCEMENT_ENABLED',
						value: billingEnforcementEnabled.apply(String),
					},
					{ name: 'BLOCK_NEW_ORG_CREATION', value: String(blockNewOrgCreation) },
					{ name: 'SENTRY_DSN', value: sentryDsn },
					{ name: 'SENTRY_ENVIRONMENT', value: sentryEnvironment },
					{ name: 'SENTRY_RELEASE', value: gitSha },
					{ name: 'POSTHOG_API_KEY', value: posthogKey },
					{ name: 'POSTHOG_HOST', value: 'https://us.i.posthog.com' },
					{ name: 'LOG_LEVEL', value: 'info' },
					{ name: 'WORKOS_CLIENT_ID', value: workosClientId },
					{
						name: 'WORKOS_REDIRECT_URI',
						value: pulumi.interpolate`https://app.${domainSuffix}/auth/callback`,
					},
					{ name: 'NO_COLOR', value: '1' },
					{ name: 'S3_ARTIFACTS_BUCKET', value: artifactsBucket.bucket },
					{ name: 'S3_ARTIFACTS_REGION', value: 'us-east-1' },
					{ name: 'DB_POOL_MAX', value: String(dbPool.max) },
					{ name: 'DB_POOL_IDLE_TIMEOUT', value: String(dbPool.idleTimeout) },
					{ name: 'DB_POOL_MAX_LIFETIME', value: String(dbPool.maxLifetime) },
					{ name: 'DB_POOL_CONNECT_TIMEOUT', value: String(dbPool.connectTimeout) },
					{ name: 'JIRA_CLIENT_ID', value: jiraClientId },
					{ name: 'LINEAR_CLIENT_ID', value: linearClientId },
					{ name: 'SLACK_CLIENT_ID', value: slackClientId },
					{ name: 'SLACK_APP_ID', value: slackAppId },
					{ name: 'GITHUB_APP_ID', value: githubAppId },
					{ name: 'GITHUB_APP_CLIENT_ID', value: githubAppClientId },
					{ name: 'GITHUB_APP_SLUG', value: githubAppSlug },
					{ name: 'STRIPE_PRICE_STARTER', value: stripeStarterPriceId },
					{ name: 'STRIPE_PRICE_PRO', value: stripeProPriceId },
					{ name: 'STRIPE_PRICE_ENTERPRISE', value: stripeEnterprisePriceId },
					{ name: 'DURABLE_STREAMS_ORIGIN', value: durableStreamsUrl },
					{ name: 'BUN_CONFIG_MAX_HTTP_REQUESTS', value: '16000' },
					{ name: 'RIPTIDE_API_ORIGIN', value: apiOrigin },
					{ name: 'CLOUD_ORIGIN', value: pulumi.interpolate`https://cloud.${domainSuffix}` },
					{ name: 'APP_ORIGIN', value: pulumi.interpolate`https://app.${domainSuffix}` },
					{ name: 'RESEND_FROM_EMAIL', value: resendFromEmail },
					{ name: 'RESEND_PRODUCT_USERS_SEGMENT_ID', value: productUsersSegmentId },
					{ name: 'ONBOARDING_CAMPAIGN_ENABLED', value: String(onboardingCampaignEnabled) },
				],
				secrets: [
					{
						name: 'DATABASE_URL',
						valueFrom: connectionUrlSecretValueArn,
					},
					{
						name: 'READ_REPLICA_DATABASE_URL',
						valueFrom: readReplicaConnectionUrlSecretValueArn,
					},
					{
						name: 'KV_URL',
						valueFrom: memorydbConnectionUrlSecretValueArn,
					},
					{
						name: 'WORKOS_API_KEY',
						valueFrom: workosApiKeySecretVersion.arn,
					},
					{
						name: 'WORKOS_WEBHOOK_SECRET',
						valueFrom: workosWebhookSecretSecretVersion.arn,
					},
					{
						name: 'STRIPE_SECRET_KEY',
						valueFrom: stripeSecretKeySecretValueArn,
					},
					{
						name: 'STRIPE_WEBHOOK_SECRET',
						valueFrom: stripeWebhookSecretSecretValueArn,
					},
					{
						name: 'RESEND_API_KEY',
						valueFrom: resendApiKeySecretVersion.arn,
					},
					{
						name: 'RESEND_WEBHOOK_SECRET',
						valueFrom: resendWebhookSecretVersion.arn,
					},
					{
						name: 'RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY',
						valueFrom: daemonTokenPublicKeySecretValueArn,
					},
					{
						name: 'RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY',
						valueFrom: daemonTokenPrivateKeySecretValueArn,
					},
					{
						name: 'ANTHROPIC_API_KEY',
						valueFrom: anthropicApiKeySecretVersion.arn,
					},
					{
						name: 'OPENAI_API_KEY',
						valueFrom: openaiApiKeySecretVersion.arn,
					},
					{
						name: 'EXA_API_KEY',
						valueFrom: exaApiKeySecretVersion.arn,
					},
					{
						name: 'CONTEXT7_API_KEY',
						valueFrom: context7ApiKeySecretVersion.arn,
					},
					{
						name: 'JIRA_CLIENT_SECRET',
						valueFrom: jiraClientSecretSecretVersion.arn,
					},
					{
						name: 'LINEAR_CLIENT_SECRET',
						valueFrom: linearClientSecretSecretVersion.arn,
					},
					{
						name: 'SLACK_CLIENT_SECRET',
						valueFrom: slackClientSecretSecretVersion.arn,
					},
					{
						name: 'SLACK_SIGNING_SECRET',
						valueFrom: slackSigningSecretSecretVersion.arn,
					},
					{
						name: 'GITHUB_APP_PRIVATE_KEY',
						valueFrom: githubAppPrivateKeySecretVersion.arn,
					},
					{
						name: 'GITHUB_APP_WEBHOOK_SECRET',
						valueFrom: githubAppWebhookSecretSecretVersion.arn,
					},
				],
			},
			taskRole: {
				args: {
					inlinePolicies: [
						{
							name: 'ecs-exec',
							policy: JSON.stringify({
								Version: '2012-10-17',
								Statement: [
									{
										Effect: 'Allow',
										Action: [
											'ssmmessages:CreateControlChannel',
											'ssmmessages:CreateDataChannel',
											'ssmmessages:OpenControlChannel',
											'ssmmessages:OpenDataChannel',
										],
										Resource: '*',
									},
								],
							}),
						},
						{
							name: 's3-artifacts',
							policy: pulumi.all([artifactsBucket.arn]).apply(([arn]) =>
								JSON.stringify({
									Version: '2012-10-17',
									Statement: [
										{
											Effect: 'Allow',
											Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
											Resource: [`${arn}/*`],
										},
									],
								}),
							),
						},
					],
				},
			},
			executionRole: {
				args: {
					inlinePolicies: [
						{
							name: 'secrets-access',
							policy: pulumi
								.all([
									connectionUrlSecretValueArn,
									readReplicaConnectionUrlSecretValueArn,
									memorydbConnectionUrlSecretValueArn,
									workosApiKeySecretVersion.arn,
									workosWebhookSecretSecretVersion.arn,
									stripeSecretKeySecretValueArn,
									stripeWebhookSecretSecretValueArn,
									resendApiKeySecretVersion.arn,
									resendWebhookSecretVersion.arn,
									daemonTokenPublicKeySecretValueArn,
									daemonTokenPrivateKeySecretValueArn,
									anthropicApiKeySecretVersion.arn,
									openaiApiKeySecretVersion.arn,
									exaApiKeySecretVersion.arn,
									context7ApiKeySecretVersion.arn,
									jiraClientSecretSecretVersion.arn,
									linearClientSecretSecretVersion.arn,
									slackClientSecretSecretVersion.arn,
									slackSigningSecretSecretVersion.arn,
									githubAppPrivateKeySecretVersion.arn,
									githubAppWebhookSecretSecretVersion.arn,
									resendApiKeySecretVersion.arn,
								])
								.apply((arns) =>
									JSON.stringify({
										Version: '2012-10-17',
										Statement: [
											{
												Effect: 'Allow',
												Action: 'secretsmanager:GetSecretValue',
												Resource: arns,
											},
										],
									}),
								),
						},
					],
				},
			},
		},
		networkConfiguration: {
			assignPublicIp: false,
			securityGroups: [apiSecurityGroup.id],
			subnets: privateSubnetIds,
		},
	},
	{ dependsOn: [rdsIngressFromApi, memorydbIngressFromApi, durableStreamsIngressFromApi, loadBalancer] },
)

// --- Sentry Release Creation ---
const _sentryRelease = new local.Command(
	'sentry-release',
	{
		create: sentryAuthToken.apply(() => {
			const version = gitSha
			return [
				`sentry-cli releases new "${version}" --org humanlayer-00 --project riptide-api`,
				`sentry-cli releases set-commits --auto --ignore-missing "${version}" --org humanlayer-00`,
				`sentry-cli releases deploys "${version}" new -e "${sentryEnvironment}" --org humanlayer-00`,
				`sentry-cli releases finalize "${version}" --org humanlayer-00`,
			].join(' && ')
		}),
		environment: sentryAuthToken.apply((token) => ({
			SENTRY_AUTH_TOKEN: token,
		})),
		triggers: [gitSha],
	},
	{ dependsOn: [service] },
)

// --- Auto-Scaling (beta/prod only) ---
if (autoScaling.enabled) {
	const { minCapacity, maxCapacity, cpuTarget, memoryTarget } = autoScaling
	if (
		minCapacity === undefined ||
		maxCapacity === undefined ||
		cpuTarget === undefined ||
		memoryTarget === undefined
	) {
		throw new Error(
			'autoScaling is enabled but one of minCapacity, maxCapacity, cpuTarget, memoryTarget is not set',
		)
	}

	const scalingTarget = new aws.appautoscaling.Target('api-scaling-target', {
		maxCapacity,
		minCapacity,
		resourceId: pulumi.interpolate`service/${service.service.cluster.apply((c) => c.split('/').pop())}/${service.service.name}`,
		scalableDimension: 'ecs:service:DesiredCount',
		serviceNamespace: 'ecs',
	})

	const _cpuScalingPolicy = new aws.appautoscaling.Policy('api-cpu-scaling', {
		policyType: 'TargetTrackingScaling',
		resourceId: scalingTarget.resourceId,
		scalableDimension: scalingTarget.scalableDimension,
		serviceNamespace: scalingTarget.serviceNamespace,
		targetTrackingScalingPolicyConfiguration: {
			predefinedMetricSpecification: {
				predefinedMetricType: 'ECSServiceAverageCPUUtilization',
			},
			targetValue: cpuTarget,
		},
	})

	const _memoryScalingPolicy = new aws.appautoscaling.Policy('api-memory-scaling', {
		policyType: 'TargetTrackingScaling',
		resourceId: scalingTarget.resourceId,
		scalableDimension: scalingTarget.scalableDimension,
		serviceNamespace: scalingTarget.serviceNamespace,
		targetTrackingScalingPolicyConfiguration: {
			predefinedMetricSpecification: {
				predefinedMetricType: 'ECSServiceAverageMemoryUtilization',
			},
			targetValue: memoryTarget,
		},
	})
}

// --- CloudWatch Alarms ---

// CPU utilization alarm
const _cpuAlarm = new aws.cloudwatch.MetricAlarm('api-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Riptide API CPU utilization over 80%',
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// Memory utilization alarm
const _memoryAlarm = new aws.cloudwatch.MetricAlarm('api-memory-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'MemoryUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Riptide API memory utilization over 80%',
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB 5xx alarm
const _alb5xxAlarm = new aws.cloudwatch.MetricAlarm('api-alb-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'HTTPCode_ELB_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: 10,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Riptide API ALB 5xx errors elevated',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB unhealthy host alarm
const _albUnhealthyHostAlarm = new aws.cloudwatch.MetricAlarm('api-alb-unhealthy-hosts', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'UnHealthyHostCount',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Average',
	threshold: 0,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Riptide API ALB has unhealthy targets',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB 4xx alarm
const _alb4xxAlarm = new aws.cloudwatch.MetricAlarm('api-alb-4xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'HTTPCode_ELB_4XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: 500,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Riptide API ALB 4xx errors elevated',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// --- Exports ---
export const serviceUrl = apiOrigin
export const artifactsBucketName = artifactsBucket.bucket
export const artifactsBucketArn = artifactsBucket.arn
export const ecsServiceName = service.service.name
export const resendApiKeyId = resendApiKeyResource.id
export const resendApiKeySecretArn = resendApiKeySecret.arn
export const resendApiKeySecretValueArn = resendApiKeySecretVersion.arn
export const resendWebhookId = resendWebhook.id
export const resendWebhookUrl = resendWebhook.endpoint
export const resendWebhookSecretArn = resendWebhookSecret.arn
export const resendWebhookSecretValueArn = resendWebhookSecretVersion.arn
