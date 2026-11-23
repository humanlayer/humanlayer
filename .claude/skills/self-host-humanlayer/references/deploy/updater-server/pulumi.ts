import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import * as aws from '@pulumi/aws'
import { local } from '@pulumi/command'
import * as pulumi from '@pulumi/pulumi'
import * as Schema from 'effect/Schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const UPDATER_ENVIRONMENTS = ['dev', 'beta', 'prod'] as const
const UpdaterEnvironment = Schema.Literals(UPDATER_ENVIRONMENTS)
type UpdaterEnvironment = typeof UpdaterEnvironment.Type

const env = Schema.decodeUnknownSync(UpdaterEnvironment)(pulumi.getStack())

function adminCliDiscoveryTags(resource: string) {
	return {
		HumanlayerPulumiManaged: 'true',
		HumanlayerPulumiEnvironment: env,
		HumanlayerPulumiLocatable: 'true',
		HumanlayerPulumiResource: resource,
	}
}

const config = new pulumi.Config()
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')

interface ReleaseConfig {
	readonly manifestPrefix: string
	readonly dmgFilename: string
}

const releaseConfigByEnvironment: Record<UpdaterEnvironment, ReleaseConfig> = {
	prod: { manifestPrefix: 'stable', dmgFilename: 'HumanLayer.dmg' },
	beta: { manifestPrefix: 'beta', dmgFilename: 'HumanLayer-Beta.dmg' },
	dev: { manifestPrefix: 'dev', dmgFilename: 'HumanLayer-Dev.dmg' },
}
const releaseConfig = releaseConfigByEnvironment[env]

// Import from core stack
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const domainSuffix = coreStack.getOutput('domainSuffix') as pulumi.Output<string>
const certificateArn = coreStack.getOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.getOutput('hostedZoneId') as pulumi.Output<string>

// --- S3 Bucket (private, stores only latest.json per variant) ---
const bucket = new aws.s3.BucketV2('updater-bucket', {
	forceDestroy: true,
	tags: adminCliDiscoveryTags('updater-bucket'),
})

new aws.s3.BucketVersioningV2('updater-bucket-versioning', {
	bucket: bucket.id,
	versioningConfiguration: { status: 'Enabled' },
})

// --- Lambda: Version Resolver ---
// Reads {variant}/latest.json from S3, compares semver, returns 200 or 204

const lambdaRole = new aws.iam.Role('updater-lambda-role', {
	assumeRolePolicy: JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Action: 'sts:AssumeRole',
				Effect: 'Allow',
				Principal: { Service: 'lambda.amazonaws.com' },
			},
		],
	}),
})

new aws.iam.RolePolicyAttachment('updater-lambda-basic', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
})

new aws.iam.RolePolicy('updater-lambda-s3-read', {
	role: lambdaRole.id,
	policy: pulumi.jsonStringify({
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Action: ['s3:GetObject'],
				Resource: pulumi.interpolate`${bucket.arn}/*`,
			},
			{
				Effect: 'Allow',
				Action: ['s3:ListBucket'],
				Resource: bucket.arn,
			},
		],
	}),
})

const logGroup = new aws.cloudwatch.LogGroup('updater-lambda-logs', {
	name: pulumi.interpolate`/aws/lambda/updater-server-${env}`,
	retentionInDays: 365,
})

const lambdaFunction = new aws.lambda.Function(
	'updater-lambda',
	{
		name: `updater-server-${env}`,
		runtime: aws.lambda.Runtime.NodeJS22dX,
		handler: 'index.handler',
		role: lambdaRole.arn,
		code: new pulumi.asset.AssetArchive({
			'index.js': new pulumi.asset.FileAsset(path.join(__dirname, '../../humanlayer/apps/updater-server/dist/index.js')),
		}),
		environment: {
			variables: {
				BUCKET_NAME: bucket.id,
				MANIFEST_PREFIX: releaseConfig.manifestPrefix,
				DMG_FILENAME: releaseConfig.dmgFilename,
				SENTRY_DSN: sentryDsn,
				SENTRY_ENVIRONMENT: sentryEnvironment,
			},
		},
		timeout: 10,
		memorySize: 128,
		loggingConfig: {
			logFormat: 'Text',
			logGroup: logGroup.name,
		},
	},
	{ dependsOn: [logGroup] },
)

const lambdaUrl = new aws.lambda.FunctionUrl('updater-lambda-url', {
	functionName: lambdaFunction.name,
	authorizationType: 'NONE',
})

// --- CloudFront Distribution ---
const updateDomain = pulumi.interpolate`update.${domainSuffix}`

// OAC for S3 origin (install.sh)
const oac = new aws.cloudfront.OriginAccessControl('updater-s3-oac', {
	originAccessControlOriginType: 's3',
	signingBehavior: 'always',
	signingProtocol: 'sigv4',
})

const distribution = new aws.cloudfront.Distribution('updater-cf', {
	enabled: true,
	aliases: [updateDomain],
	tags: adminCliDiscoveryTags('updater-distribution'),
	viewerCertificate: {
		acmCertificateArn: certificateArn,
		sslSupportMethod: 'sni-only',
		minimumProtocolVersion: 'TLSv1.2_2021',
	},
	// Default origin: Lambda Function URL (version checks)
	defaultCacheBehavior: {
		targetOriginId: 'lambda',
		viewerProtocolPolicy: 'redirect-to-https',
		allowedMethods: ['GET', 'HEAD'],
		cachedMethods: ['GET', 'HEAD'],
		forwardedValues: {
			queryString: false,
			cookies: { forward: 'none' },
		},
		defaultTtl: 60,
		maxTtl: 120,
		minTtl: 0,
	},
	// /install.sh → S3 origin (long TTL)
	orderedCacheBehaviors: [
		{
			pathPattern: '/install.sh',
			targetOriginId: 's3',
			viewerProtocolPolicy: 'redirect-to-https',
			allowedMethods: ['GET', 'HEAD'],
			cachedMethods: ['GET', 'HEAD'],
			forwardedValues: {
				queryString: false,
				cookies: { forward: 'none' },
			},
			defaultTtl: 86400,
			maxTtl: 604800,
			minTtl: 0,
		},
		// electron-updater YAML manifests (e.g. /dev/latest-mac.yml) → S3
		// Short TTLs so new manifests propagate within two minutes.
		// The existing cache invalidation (/{variant}/*) covers these paths.
		{
			pathPattern: '/*.yml',
			targetOriginId: 's3',
			viewerProtocolPolicy: 'redirect-to-https',
			allowedMethods: ['GET', 'HEAD'],
			cachedMethods: ['GET', 'HEAD'],
			forwardedValues: {
				queryString: false,
				cookies: { forward: 'none' },
			},
			defaultTtl: 60,
			maxTtl: 120,
			minTtl: 0,
		},
	],
	origins: [
		{
			originId: 'lambda',
			domainName: lambdaUrl.functionUrl.apply((url) => url.replace('https://', '').replace('/', '')),
			customOriginConfig: {
				httpPort: 80,
				httpsPort: 443,
				originProtocolPolicy: 'https-only',
				originSslProtocols: ['TLSv1.2'],
			},
		},
		{
			originId: 's3',
			domainName: bucket.bucketRegionalDomainName,
			originAccessControlId: oac.id,
			s3OriginConfig: {
				originAccessIdentity: '',
			},
		},
	],
	restrictions: {
		geoRestriction: { restrictionType: 'none' },
	},
})

// Allow CloudFront to read from S3
new aws.s3.BucketPolicy(
	'updater-cf-s3-policy',
	{
		bucket: bucket.id,
		policy: pulumi.all([bucket.arn, distribution.arn]).apply(([bucketArn, distArn]) =>
			JSON.stringify({
				Version: '2012-10-17',
				Statement: [
					{
						Sid: 'AllowCloudFrontServicePrincipalReadOnly',
						Effect: 'Allow',
						Principal: { Service: 'cloudfront.amazonaws.com' },
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
	},
	{ dependsOn: [distribution] },
)

// --- Route53 A-alias record ---
new aws.route53.Record('updater-dns', {
	zoneId: hostedZoneId,
	name: updateDomain,
	type: 'A',
	aliases: [
		{
			name: distribution.domainName,
			zoneId: distribution.hostedZoneId,
			evaluateTargetHealth: false,
		},
	],
})

// --- CloudFront Cache Invalidation ---
const invalidationPaths: Record<UpdaterEnvironment, string> = {
	dev: '/dev/*',
	beta: '/beta/*',
	prod: '/stable/*',
}

const _invalidation = new local.Command(
	'updater-cf-invalidation',
	{
		create: pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths "${invalidationPaths[env]}"`,
		triggers: [Date.now().toString()],
	},
	{ dependsOn: [distribution] },
)

// --- Exports ---
export const distributionId = distribution.id
export const bucketName = bucket.id
export const updateUrl = pulumi.interpolate`https://${updateDomain}`
