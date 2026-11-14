import { execSync } from 'node:child_process'

import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
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

interface DbPoolConfig {
	max: number
	idleTimeout: number
	maxLifetime: number
	connectTimeout: number
}

interface AlarmThresholds {
	albTarget5xxCount: number
}

const config = new pulumi.Config()
const fargate = config.requireObject<FargateConfig>('fargate')
const dbPool = config.requireObject<DbPoolConfig>('dbPool')
const alarmThresholds = config.requireObject<AlarmThresholds>('alarmThresholds')
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
const workosApiKey = config.requireSecret('workosApiKey')
const workosClientId = config.require('workosClientId')

const env = pulumi.getStack()

const gitSha = process.env.HUMANLAYER_SHA ?? execSync('git rev-parse HEAD', { cwd: '../../humanlayer' }).toString().trim()

// Get the ELB service account for access logs
const elbServiceAccount = aws.elb.getServiceAccountOutput()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const rdsStack = new pulumi.StackReference(`humanlayer/rds-postgres/${env}`)
const electricStack = new pulumi.StackReference(`humanlayer/electric-sql/${env}`)
const daemonTokenKeysStack = new pulumi.StackReference(`humanlayer/daemon-token-keys/${env}`)
const rustDurableStreamsStack = new pulumi.StackReference(`humanlayer/rust-durable-streams/${env}`)

// Import from core stack
const ecsClusterArn = coreStack.requireOutput('ecsClusterArn')
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const publicSubnetIds = coreStack.requireOutput('publicSubnetIds') as pulumi.Output<string[]>
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>

// Import from RDS stack
const connectionUrlSecretValueArn = rdsStack.requireOutput('connectionUrlSecretValueArn') as pulumi.Output<string>
const rdsSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>

// Import from Electric SQL stack
const electricUrl = electricStack.requireOutput('electricUrl') as pulumi.Output<string>
const electricSecretValueArn = electricStack.requireOutput('electricSecretValueArn') as pulumi.Output<string>

// Import from Rust Durable Streams stack
const durableStreamsUrl = rustDurableStreamsStack.requireOutput('durableStreamsUrl') as pulumi.Output<string>
const durableStreamsAlbSecurityGroupId = rustDurableStreamsStack.requireOutput(
	'albSecurityGroupId',
) as pulumi.Output<string>

// Import from daemon-token-keys stack
const daemonTokenPublicKeySecretValueArn = daemonTokenKeysStack.requireOutput(
	'publicKeySecretValueArn',
) as pulumi.Output<string>

// --- ECR Repository ---
const ecrRepo = new awsx.ecr.Repository('electric-proxy-repo', {
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
const image = new dockerBuild.Image('electric-proxy-image', {
	context: { location: '../../humanlayer' },
	dockerfile: { location: '../../humanlayer/apps/riptide-electric-proxy/Dockerfile' },
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
const albLogsBucket = new aws.s3.Bucket('proxy-alb-logs', {
	forceDestroy: true,
})

const _albLogsBucketPolicy = new aws.s3.BucketPolicy('proxy-alb-logs-policy', {
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

// --- Public Application Load Balancer ---
const loadBalancer = new awsx.lb.ApplicationLoadBalancer('proxy-alb', {
	internal: false,
	subnetIds: publicSubnetIds,
	accessLogs: {
		enabled: true,
		bucket: albLogsBucket.id,
		prefix: 'proxy-alb',
	},
	defaultTargetGroup: {
		port: 8888,
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

// --- Route53 A-alias record: sync.{domainSuffix} → ALB ---
const _dnsRecord = new aws.route53.Record('proxy-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`sync.${domainSuffix}`,
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
const proxySecurityGroup = new aws.ec2.SecurityGroup('proxy-ecs-sg', {
	description: 'Allows connections from the load balancer to the electric proxy',
	vpcId,
	ingress: [
		{
			protocol: 'tcp',
			fromPort: 8888,
			toPort: 8888,
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

// --- Security Group Rule: Allow proxy to access RDS ---
const rdsIngressFromProxy = new aws.ec2.SecurityGroupRule('proxy-postgres-access-rule', {
	type: 'ingress',
	description: 'Allow Electric Proxy to connect to postgres',
	sourceSecurityGroupId: proxySecurityGroup.id,
	securityGroupId: rdsSecurityGroupId,
	fromPort: 5432,
	toPort: 5432,
	protocol: 'tcp',
})

const durableStreamsIngress = new aws.ec2.SecurityGroupRule('proxy-to-durable-streams', {
	type: 'ingress',
	description: 'Allow Electric Proxy to reach Durable Streams ALB',
	sourceSecurityGroupId: proxySecurityGroup.id,
	securityGroupId: durableStreamsAlbSecurityGroupId,
	fromPort: 443,
	toPort: 443,
	protocol: 'tcp',
})

// --- Secrets Manager entries from Pulumi encrypted config ---
const workosApiKeySecret = new aws.secretsmanager.Secret(
	'proxy-workos-api-key',
	{
		name: `riptide-electric-proxy/${env}/workos-api-key`,
	},
	{ deleteBeforeReplace: true },
)
const workosApiKeySecretVersion = new aws.secretsmanager.SecretVersion('proxy-workos-api-key-value', {
	secretId: workosApiKeySecret.id,
	secretString: workosApiKey,
})

// --- Fargate Service ---
const service = new awsx.ecs.FargateService(
	'electric-proxy',
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
			family: `electric-proxy-${env}`,
			skipDestroy: true,
			container: {
				name: 'riptide-electric-proxy',
				image: image.ref,
				cpu: fargate.cpu,
				memory: fargate.memory,
				essential: true,
				portMappings: [
					{
						containerPort: 8888,
						hostPort: 8888,
						targetGroup: loadBalancer.defaultTargetGroup,
					},
				],
				environment: [
					{ name: 'NODE_OPTIONS', value: `--max-old-space-size=${Math.floor(fargate.memory * 0.75)}` },
					{ name: 'PORT', value: '8888' },
					{ name: 'NODE_ENV', value: 'production' },
					{ name: 'SENTRY_DSN', value: sentryDsn },
					{ name: 'SENTRY_ENVIRONMENT', value: sentryEnvironment },
					{ name: 'SENTRY_RELEASE', value: gitSha },
					{ name: 'LOG_LEVEL', value: 'info' },
					{ name: 'WORKOS_CLIENT_ID', value: workosClientId },
					{
						name: 'WORKOS_REDIRECT_URI',
						value: pulumi.interpolate`https://app.${domainSuffix}/auth/callback`,
					},
					{
						name: 'ELECTRIC_SHAPE_URL',
						value: pulumi.interpolate`${electricUrl}/v1/shape`,
					},
					{ name: 'NO_COLOR', value: '1' },
					{ name: 'DURABLE_STREAMS_ORIGIN', value: durableStreamsUrl },
					{ name: 'DB_POOL_MAX', value: String(dbPool.max) },
					{ name: 'DB_POOL_IDLE_TIMEOUT', value: String(dbPool.idleTimeout) },
					{ name: 'DB_POOL_MAX_LIFETIME', value: String(dbPool.maxLifetime) },
					{ name: 'DB_POOL_CONNECT_TIMEOUT', value: String(dbPool.connectTimeout) },
					{ name: 'BUN_CONFIG_MAX_HTTP_REQUESTS', value: '16000' },
				],
				secrets: [
					{
						name: 'DATABASE_URL',
						valueFrom: connectionUrlSecretValueArn,
					},
					{
						name: 'ELECTRIC_SECRET',
						valueFrom: electricSecretValueArn,
					},
					{
						name: 'WORKOS_API_KEY',
						valueFrom: workosApiKeySecretVersion.arn,
					},
					{
						name: 'RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY',
						valueFrom: daemonTokenPublicKeySecretValueArn,
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
									electricSecretValueArn,
									workosApiKeySecretVersion.arn,
									daemonTokenPublicKeySecretValueArn,
								])
								.apply(([pgArn, electricArn, workosArn, daemonArn]) =>
									JSON.stringify({
										Version: '2012-10-17',
										Statement: [
											{
												Effect: 'Allow',
												Action: 'secretsmanager:GetSecretValue',
												Resource: [pgArn, electricArn, workosArn, daemonArn],
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
			securityGroups: [proxySecurityGroup.id],
			subnets: privateSubnetIds,
		},
	},
	{ dependsOn: [rdsIngressFromProxy, durableStreamsIngress, loadBalancer] },
)

// --- Sentry Release Creation ---
const _sentryRelease = new local.Command(
	'sentry-release',
	{
		create: sentryAuthToken.apply(() => {
			const version = gitSha
			return [
				`sentry-cli releases new "${version}" --org humanlayer-00 --project riptide-electric-proxy`,
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

// --- CloudWatch Alarms ---

// CPU utilization alarm
const _cpuAlarm = new aws.cloudwatch.MetricAlarm('proxy-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Electric Proxy CPU utilization over 80%',
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// Memory utilization alarm
const _memoryAlarm = new aws.cloudwatch.MetricAlarm('proxy-memory-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'MemoryUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Electric Proxy memory utilization over 80%',
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB 5xx alarm
const _alb5xxAlarm = new aws.cloudwatch.MetricAlarm('proxy-alb-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'HTTPCode_ELB_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: 10,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Electric Proxy ALB 5xx errors elevated',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB unhealthy host alarm
const _albUnhealthyHostAlarm = new aws.cloudwatch.MetricAlarm('proxy-alb-unhealthy-hosts', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'UnHealthyHostCount',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Average',
	threshold: 0,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Electric Proxy ALB has unhealthy targets',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB target (app-origin) 5xx alarm — catches app-emitted 5xx (e.g. DB-blip 503s) that
// HTTPCode_ELB_5XX_Count misses. The 2026-06-10 ~1,637/5min target-5xx burst went unalarmed.
const _albTarget5xxAlarm = new aws.cloudwatch.MetricAlarm('proxy-alb-target-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'HTTPCode_Target_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: alarmThresholds.albTarget5xxCount,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Electric Proxy target (app-origin) 5xx errors elevated',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// --- Exports ---
export const serviceUrl = pulumi.interpolate`https://sync.${domainSuffix}`
export const securityGroupId = proxySecurityGroup.id
export const ecsServiceName = service.service.name
