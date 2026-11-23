import { execSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSpaSecurityHeadersPolicy } from '@humanlayer/pulumi-helpers/cloudfront'
import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import { StaticSiteAssets } from '@humanlayer/pulumi-helpers/static-site-assets'
import * as aws from '@pulumi/aws'
import { local } from '@pulumi/command'
import * as pulumi from '@pulumi/pulumi'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const config = new pulumi.Config()
const workosClientId = config.require('workosClientId')
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')
const sentryAuthToken = config.requireSecret('sentryAuthToken')
const buildType = config.require('buildType')
const deepLinkScheme = config.require('deepLinkScheme')
const posthogKey = config.require('posthogKey')

const env = pulumi.getStack()

const gitSha = process.env.HUMANLAYER_SHA ?? execSync('git rev-parse HEAD', { cwd: '../../humanlayer' }).toString().trim()
const deploymentId = Date.now().toString()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const riptideApiStack = new pulumi.StackReference(`humanlayer/riptide-api/${env}`)
const electricProxyStack = new pulumi.StackReference(`humanlayer/riptide-electric-proxy/${env}`)
const riptideCloudStack = new pulumi.StackReference(`humanlayer/riptide-cloud/${env}`)
const stripeStack = new pulumi.StackReference(`humanlayer/stripe/${env}`)

// Import from core stack
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>
// Import from downstream stacks
const apiUrl = riptideApiStack.requireOutput('serviceUrl') as pulumi.Output<string>
const syncOrigin = electricProxyStack.requireOutput('serviceUrl') as pulumi.Output<string>
const cloudOrigin = riptideCloudStack.requireOutput('cloudUrl') as pulumi.Output<string>
const billingEnforcementEnabled = stripeStack.requireOutput('billingEnforcementEnabled') as pulumi.Output<boolean>

// --- Vite Build ---
const viteBuild = new local.Command('vite-build', {
	create: 'bun run build',
	dir: '.',
	environment: pulumi
		.all([apiUrl, syncOrigin, cloudOrigin, billingEnforcementEnabled, gitSha, sentryAuthToken, domainSuffix])
		.apply(
			([
				apiUrlVal,
				syncOriginVal,
				cloudOriginVal,
				billingEnforcementEnabledVal,
				sha,
				authToken,
				domainSuffixVal,
			]) => {
				const environment = {
					VITE_PUBLIC_RIPTIDE_API_ORIGIN: apiUrlVal,
					VITE_PUBLIC_SYNC_ORIGIN: syncOriginVal,
					VITE_PUBLIC_WORKOS_CLIENT_ID: workosClientId,
					VITE_PUBLIC_BUILD_TYPE: buildType,
					VITE_PUBLIC_REMOTE_DAEMON_BUILD_TYPE: buildType,
					VITE_PUBLIC_DEEP_LINK_SCHEME: deepLinkScheme,
					VITE_PUBLIC_CLOUD_ORIGIN: cloudOriginVal,
					VITE_PUBLIC_APP_ORIGIN: `https://app.${domainSuffixVal}`,
					VITE_PUBLIC_POSTHOG_KEY: posthogKey,
					VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED: String(billingEnforcementEnabledVal),
					VITE_PUBLIC_ENVIRONMENT: env,
					VITE_PUBLIC_BUILD_VERSION: sha.trim(),
					VITE_PUBLIC_SENTRY_DSN: sentryDsn,
					VITE_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment,
					NODE_ENV: 'production',
					// vite build with Sentry sourcemaps exceeds Node's default heap
					NODE_OPTIONS: '--max-old-space-size=8192',
					// Sentry sourcemap upload
					SENTRY_ORG: 'humanlayer-00',
					SENTRY_PROJECT: 'riptide-ui',
				}
				const sentryAuthentication = authToken ? { SENTRY_AUTH_TOKEN: authToken } : {}
				return { ...environment, ...sentryAuthentication }
			},
		),
	triggers: [apiUrl, syncOrigin, cloudOrigin, billingEnforcementEnabled, workosClientId, posthogKey, deploymentId],
})

// --- S3 Bucket (private, no public access) ---
const siteBucket = new aws.s3.Bucket('riptide-ui-bucket', {
	forceDestroy: true,
})

const _bucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock('riptide-ui-public-access-block', {
	bucket: siteBucket.id,
	blockPublicAcls: true,
	blockPublicPolicy: true,
	ignorePublicAcls: true,
	restrictPublicBuckets: true,
})

// --- CloudFront Origin Access Control ---
const oac = new aws.cloudfront.OriginAccessControl('riptide-ui-oac', {
	name: `riptide-ui-${env}`,
	originAccessControlOriginType: 's3',
	signingBehavior: 'always',
	signingProtocol: 'sigv4',
})

const securityHeadersPolicy = createSpaSecurityHeadersPolicy(`riptide-ui-security-headers-${env}`, {
	apiOrigin: apiUrl,
	syncOrigin,
	sentryIngestOrigin: new URL(sentryDsn).origin,
	additionalConnectSrc: ['https://registry.npmjs.org'],
})

// --- CloudFront Distribution ---
const distribution = new aws.cloudfront.Distribution(
	'riptide-ui-cdn',
	{
		enabled: true,
		defaultRootObject: 'index.html',
		waitForDeployment: true,
		aliases: [pulumi.interpolate`app.${domainSuffix}`],
		origins: [
			{
				originId: 'S3Origin',
				domainName: siteBucket.bucketRegionalDomainName,
				originAccessControlId: oac.id,
			},
		],
		defaultCacheBehavior: {
			targetOriginId: 'S3Origin',
			viewerProtocolPolicy: 'redirect-to-https',
			responseHeadersPolicyId: securityHeadersPolicy.id,
			allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
			cachedMethods: ['GET', 'HEAD'],
			forwardedValues: {
				queryString: false,
				cookies: { forward: 'none' },
			},
			compress: true,
			minTtl: 0,
			defaultTtl: 86400,
			maxTtl: 31536000,
		},
		customErrorResponses: [
			{
				errorCode: 403,
				responseCode: 200,
				responsePagePath: '/index.html',
				errorCachingMinTtl: 10,
			},
			{
				errorCode: 404,
				responseCode: 200,
				responsePagePath: '/index.html',
				errorCachingMinTtl: 10,
			},
		],
		viewerCertificate: {
			acmCertificateArn: validatedCertificateArn,
			sslSupportMethod: 'sni-only',
			minimumProtocolVersion: 'TLSv1.2_2021',
		},
		restrictions: {
			geoRestriction: {
				restrictionType: 'none',
			},
		},
		priceClass: 'PriceClass_100',
	},
	{ dependsOn: [siteBucket] },
)

// --- S3 Bucket Policy: Allow CloudFront OAC access ---
const _bucketPolicy = new aws.s3.BucketPolicy('riptide-ui-bucket-policy', {
	bucket: siteBucket.id,
	policy: pulumi.all([siteBucket.arn, distribution.arn]).apply(([bucketArn, distArn]) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'AllowCloudFrontServicePrincipalReadOnly',
					Effect: 'Allow',
					Principal: {
						Service: 'cloudfront.amazonaws.com',
					},
					Action: 's3:GetObject',
					Resource: `${bucketArn}/*`,
					Condition: {
						StringEquals: {
							'AWS:SourceArn': distArn,
						},
					},
				},
				denyInsecureTransportStatement(bucketArn),
			],
		}),
	),
})

// --- Route53 A-alias: app.{domainSuffix} → CloudFront ---
const _dnsRecord = new aws.route53.Record('riptide-ui-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`app.${domainSuffix}`,
	type: 'A',
	aliases: [
		{
			name: distribution.domainName,
			zoneId: distribution.hostedZoneId,
			evaluateTargetHealth: false,
		},
	],
})

// --- S3 Object Upload ---
const siteAssets = new StaticSiteAssets(
	'riptide-ui-assets',
	{
		build: viteBuild,
		deploymentId,
		path: path.resolve(__dirname, '../../humanlayer/apps/riptide-ui/dist'),
		bucketName: siteBucket.bucket,
	},
	{ parent: siteBucket },
)

// --- CloudFront Cache Invalidation after deploy ---
const _invalidation = new local.Command(
	'riptide-ui-invalidation',
	{
		create: pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths "/*"`,
		triggers: [viteBuild.stdout],
	},
	{ dependsOn: [distribution, siteAssets.syncCommand] },
)

// --- Sentry Release Creation ---
const _sentryRelease = new local.Command(
	'sentry-release',
	{
		create: sentryAuthToken.apply(() => {
			const version = gitSha
			return [
				`sentry-cli releases new "${version}" --org humanlayer-00 --project riptide-ui`,
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
	{ dependsOn: [_invalidation] },
)

// --- Exports ---
export const appUrl = pulumi.interpolate`https://app.${domainSuffix}`
export const distributionId = distribution.id
