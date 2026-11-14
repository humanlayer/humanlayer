import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

// Configuration interfaces
interface FargateConfig {
	cpu: number
	memory: number
	ephemeralStorage: number
	desiredCount: number
}

interface AlarmThresholds {
	cpuPercent: number
	memoryPercent: number
	alb5xxCountCritical: number
	alb5xxCountWarning: number
	ephemeralStorageGiB: number
}

const config = new pulumi.Config()
const fargate = config.requireObject<FargateConfig>('fargate')
const alarmThresholds = config.requireObject<AlarmThresholds>('alarmThresholds')
const imageTag = config.require('imageTag')
const imageName = config.get('imageName') || 'electricsql/electric'
const registryType = config.get('registryType') || 'docker-hub' // 'docker-hub' or 'ghcr'
const electricFeatureFlags = config.get('featureFlags')
const honeycombApiKey = config.requireSecret('honeycombApiKey')
const honeycombDataset = config.require('honeycombDataset')
const otelSamplingRatio = config.require('otelSamplingRatio')
const electricDbPoolSize = config.require('electricDbPoolSize')
const electricMaxShapes = config.require('electricMaxShapes')
const electricMaxConcurrentRequests = config.require('electricMaxConcurrentRequests')
const fargateRuntimePlatform = {
	cpuArchitecture: 'ARM64',
	operatingSystemFamily: 'LINUX',
} as const
// Optional BEAM binary-memory GC tuning. Only set on stacks running Electric >= 1.7.0.
// Mitigates refc-binary retention OOM (ecs-crash-loop-alarm, June 2026): forces periodic
// full-sweep GC on Bandit handler processes and enables consumer hibernate-then-suspend GC.
const handlerFullsweepAfter = config.get('handlerFullsweepAfter')
const shapeSuspendConsumer = config.get('shapeSuspendConsumer')
const sentryDsn = 'PLACEHOLDER_SENTRY_DSN_PLACEHOLDER'

const env = pulumi.getStack()

const electricContainerEnvironment = [
	{
		name: 'SENTRY_DSN',
		value: sentryDsn,
	},
	{
		name: 'ELECTRIC_LOG_COLORS',
		value: 'false',
	},
	{
		name: 'ELECTRIC_TCP_READ_TIMEOUT',
		value: '120s',
	},
	{
		name: 'ELECTRIC_DROP_EMPTY_RESPONSE_SPANS',
		value: 'true',
	},
]
if (electricFeatureFlags) {
	electricContainerEnvironment.push({ name: 'ELECTRIC_FEATURE_FLAGS', value: electricFeatureFlags })
}
// ELECTRIC_PROMETHEUS_PORT intentionally NOT set. Setting it starts Electric's
// telemetry_metrics_prometheus_core exporter, whose `:prometheus_metrics_dist` ETS
// table (a :duplicate_bag) grows unbounded: it appends one row per
// `electric.postgres.replication.transaction_received.receive_lag` distribution
// observation (~1 per replication txn) and never aggregates/prunes them. On prod
// this reached ~1.7M rows / ~322 MB in ~14h (~0.55 GB/day) and was the dominant
// driver of the BEAM ETS memory ramp that OOM'd the singleton task (June 2026).
// Telemetry still flows to Honeycomb via ELECTRIC_OTLP_ENDPOINT and we alarm on
// CloudWatch ECS metrics, so nothing scrapes :9568. Restore this (and the 9568
// portMapping above) only once the upstream distribution-metric storage is fixed.
// {
// 	name: 'ELECTRIC_PROMETHEUS_PORT',
// 	value: '9568',
// },
electricContainerEnvironment.push(
	{
		name: 'ELECTRIC_OTLP_ENDPOINT',
		value: 'https://api.honeycomb.io',
	},
	{
		name: 'ELECTRIC_HNY_DATASET',
		value: honeycombDataset,
	},
	{
		name: 'ELECTRIC_SERVICE_NAME',
		value: 'electric',
	},
	{
		name: 'ELECTRIC_OTEL_SAMPLING_RATIO',
		value: otelSamplingRatio,
	},
	{
		name: 'ELECTRIC_DB_POOL_SIZE',
		value: electricDbPoolSize,
	},
	{
		name: 'ELECTRIC_MAX_SHAPES',
		value: electricMaxShapes,
	},
	{
		name: 'ELECTRIC_MAX_CONCURRENT_REQUESTS',
		value: electricMaxConcurrentRequests,
	},
)
// BEAM binary-memory GC tuning (Electric >= 1.7.0). See incident: refc-binary
// retention OOM (ecs-crash-loop-alarm). Conditional so any stack that omits
// the config keys is unchanged.
if (handlerFullsweepAfter) {
	electricContainerEnvironment.push({
		name: 'ELECTRIC_TWEAKS_HANDLER_FULLSWEEP_AFTER',
		value: handlerFullsweepAfter,
	})
}
if (shapeSuspendConsumer) {
	electricContainerEnvironment.push({
		name: 'ELECTRIC_SHAPE_SUSPEND_CONSUMER',
		value: shapeSuspendConsumer,
	})
}

// Get the ELB service account for access logs (varies by region)
const elbServiceAccount = aws.elb.getServiceAccountOutput()

// AWS account and region for ECR image URI
const callerIdentity = aws.getCallerIdentityOutput()
const currentRegion = aws.getRegionOutput()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const rdsStack = new pulumi.StackReference(`humanlayer/rds-postgres/${env}`)

// Import from core stack
const ecsClusterArn = coreStack.requireOutput('ecsClusterArn')
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const vpcPrivateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const servicediscoveryNamespaceId = coreStack.requireOutput('servicediscoveryNamespaceId') as pulumi.Output<string>
const ecrDockerHubPrefix = coreStack.requireOutput('ecrDockerHubPrefix') as pulumi.Output<string>
const ecrGhcrPrefix = coreStack.requireOutput('ecrGhcrPrefix') as pulumi.Output<string>
const ecrRepositoryPrefix = registryType === 'ghcr' ? ecrGhcrPrefix : ecrDockerHubPrefix

// Import from RDS stack
const postgresUrlSecretArn = rdsStack.requireOutput('connectionUrlSecretValueArn') as pulumi.Output<string>
const rdsPostgresSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>

// --- S3 bucket for ALB access logs ---
const albLogsBucket = new aws.s3.Bucket('electric-alb-logs', {
	forceDestroy: true,
})

const albLogsBucketPolicy = new aws.s3.BucketPolicy('electric-alb-logs-policy', {
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

// --- Internal Application Load Balancer ---
const loadBalancer = new awsx.lb.ApplicationLoadBalancer('electric-alb', {
	internal: true,
	subnetIds: vpcPrivateSubnetIds,
	accessLogs: {
		enabled: true,
		bucket: albLogsBucket.id,
		prefix: 'electric-alb',
	},
	defaultTargetGroup: {
		port: 3000, // electric port
		protocol: 'HTTP',
		deregistrationDelay: 30, // Short delay: Electric uses an advisory lock so only 1 task runs at a time. Long draining keeps the lock held, blocking the replacement task from starting.
		healthCheck: {
			enabled: true,
			path: '/v1/health',
			protocol: 'HTTP',
			matcher: '200-299',
			interval: 10,
			healthyThreshold: 2,
			unhealthyThreshold: 3,
		},
	},
})

// --- HTTPS Listener (TLS termination at ALB, forwards HTTP to target group) ---
const httpsListener = new aws.lb.Listener('electric-https-listener', {
	loadBalancerArn: loadBalancer.loadBalancer.arn,
	port: 443,
	protocol: 'HTTPS',
	certificateArn: validatedCertificateArn,
	defaultActions: [
		{
			type: 'forward',
			targetGroupArn: loadBalancer.defaultTargetGroup.arn,
		},
	],
})

// --- Route53 A-alias record: electric.{domainSuffix} → internal ALB ---
const dnsRecord = new aws.route53.Record('electric-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`electric.${domainSuffix}`,
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
const electricSecurityGroup = new aws.ec2.SecurityGroup('electric-ecs-sg', {
	description: 'Allows connections from the load balancer to the electric instance',
	vpcId: vpcId,
	ingress: [
		{
			protocol: 'tcp',
			fromPort: 3000,
			toPort: 3000,
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

// --- ELECTRIC_SECRET via random password → Secrets Manager ---
const electricConnectionSecret = new aws.secretsmanager.Secret(
	'electric-secret',
	{
		name: `electric-sql/${env}/secret`,
	},
	{ deleteBeforeReplace: true },
)

const electricConnectionSecretString = new random.RandomPassword('electric-secret-random-string', {
	keepers: {
		rotation: '2026-04-29', // change this value to rotate the secret
	},
	length: 32,
	special: false,
})

const electricConnectionSecretVersion = new aws.secretsmanager.SecretVersion('electric-secret-value', {
	secretId: electricConnectionSecret.id,
	secretString: electricConnectionSecretString.result,
})

// --- Honeycomb API key for OTEL traces ---
const honeycombApiKeySecret = new aws.secretsmanager.Secret(
	'electric-honeycomb-api-key',
	{
		name: `electric-sql/${env}/honeycomb-api-key`,
	},
	{ deleteBeforeReplace: true },
)

const honeycombApiKeySecretVersion = new aws.secretsmanager.SecretVersion('electric-honeycomb-api-key-value', {
	secretId: honeycombApiKeySecret.id,
	secretString: honeycombApiKey,
})

// --- Security Group Rule: Allow Electric to access RDS ---
const electricPostgresSecurityGroupRule = new aws.ec2.SecurityGroupRule('electric-postgres-access-rule', {
	type: 'ingress',
	description: 'Allow Electric Service to connect to postgres',
	sourceSecurityGroupId: electricSecurityGroup.id,
	securityGroupId: rdsPostgresSecurityGroupId,
	fromPort: 5432,
	toPort: 5432,
	protocol: 'tcp',
})

// --- Cloud Map Service Discovery ---
const electricServiceDiscovery = new aws.servicediscovery.Service('electric-sd', {
	name: 'electric',
	dnsConfig: {
		namespaceId: servicediscoveryNamespaceId,
		dnsRecords: [{ ttl: 10, type: 'A' }],
		routingPolicy: 'MULTIVALUE',
	},
	healthCheckCustomConfig: {
		failureThreshold: 1,
	},
	forceDestroy: true,
})

// --- Fargate Service for Electric ---
const service = new awsx.ecs.FargateService(
	'electric',
	{
		cluster: ecsClusterArn,
		desiredCount: fargate.desiredCount,
		enableExecuteCommand: true,
		healthCheckGracePeriodSeconds: 120,
		deploymentCircuitBreaker: {
			enable: true,
			rollback: true,
		},
		serviceRegistries: {
			registryArn: electricServiceDiscovery.arn,
		},
		taskDefinitionArgs: {
			runtimePlatform: fargateRuntimePlatform,
			logGroup: {
				args: {
					retentionInDays: 365,
				},
			},
			family: `electric-${env}`,
			skipDestroy: true,
			container: {
				name: 'electricsql',
				image: pulumi.interpolate`${callerIdentity.accountId}.dkr.ecr.${currentRegion.name}.amazonaws.com/${ecrRepositoryPrefix}/${imageName}:${imageTag}`,
				cpu: fargate.cpu,
				memory: fargate.memory,
				essential: true,
				portMappings: [
					{
						containerPort: 3000,
						hostPort: 3000,
						targetGroup: loadBalancer.defaultTargetGroup,
					},
					// Prometheus metrics port (9568) intentionally disabled along with
					// ELECTRIC_PROMETHEUS_PORT below — with the exporter off nothing listens here.
					// {
					// 	containerPort: 9568,
					// 	hostPort: 9568,
					// },
				],
				environment: electricContainerEnvironment,
				secrets: [
					{
						name: 'DATABASE_URL',
						valueFrom: postgresUrlSecretArn,
					},
					{
						name: 'ELECTRIC_SECRET',
						valueFrom: electricConnectionSecretVersion.arn,
					},
					{
						name: 'ELECTRIC_HNY_API_KEY',
						valueFrom: honeycombApiKeySecretVersion.arn,
					},
				],
				healthCheck: {
					command: ['CMD-SHELL', 'curl -f http://localhost:3000/v1/health || exit 1'],
					interval: 30,
					timeout: 5,
					retries: 3,
					startPeriod: 10,
				},
			},
			ephemeralStorage: {
				sizeInGib: fargate.ephemeralStorage,
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
									postgresUrlSecretArn,
									electricConnectionSecretVersion.arn,
									honeycombApiKeySecretVersion.arn,
								])
								.apply(([pgArn, electricArn, honeycombArn]) =>
									JSON.stringify({
										Version: '2012-10-17',
										Statement: [
											{
												Effect: 'Allow',
												Action: 'secretsmanager:GetSecretValue',
												Resource: [pgArn, electricArn, honeycombArn],
											},
										],
									}),
								),
						},
						{
							name: 'ecr-pull-through-cache',
							policy: pulumi
								.all([callerIdentity.accountId, currentRegion.name, ecrDockerHubPrefix, ecrGhcrPrefix])
								.apply(([accountId, region, dhPrefix, ghPrefix]) =>
									JSON.stringify({
										Version: '2012-10-17',
										Statement: [
											{
												Effect: 'Allow',
												Action: ['ecr:BatchImportUpstreamImage', 'ecr:CreateRepository'],
												Resource: [
													`arn:aws:ecr:${region}:${accountId}:repository/${dhPrefix}/*`,
													`arn:aws:ecr:${region}:${accountId}:repository/${ghPrefix}/*`,
												],
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
			securityGroups: [electricSecurityGroup.id],
			subnets: vpcPrivateSubnetIds,
		},
	},
	{ dependsOn: [electricPostgresSecurityGroupRule, loadBalancer, electricServiceDiscovery] },
)

// --- CloudWatch Alarms ---
// Thresholds are configured per-environment in Pulumi.{stack}.yaml

// CPU utilization alarm — uses Maximum to catch spikes
const cpuAlarm = new aws.cloudwatch.MetricAlarm('electric-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Maximum',
	threshold: alarmThresholds.cpuPercent,
	alarmDescription: `Electric SQL CPU spike above ${alarmThresholds.cpuPercent}% (intentionally over-provisioned, spike indicates unusual load)`,
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// Memory utilization alarm
const memoryAlarm = new aws.cloudwatch.MetricAlarm('electric-memory-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 3,
	metricName: 'MemoryUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: alarmThresholds.memoryPercent,
	alarmDescription: `Electric SQL memory utilization above ${alarmThresholds.memoryPercent}%`,
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB 5xx critical alarm — fires in 5 min for real outages (SIGSEGV, bad deploys)
const alb5xxAlarm = new aws.cloudwatch.MetricAlarm('electric-alb-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 1,
	metricName: 'HTTPCode_ELB_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: alarmThresholds.alb5xxCountCritical,
	treatMissingData: 'notBreaching',
	alarmDescription: `CRITICAL: Electric SQL ALB 5xx errors above ${alarmThresholds.alb5xxCountCritical}/5min — likely real outage (SIGSEGV, bad deploy)`,
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ALB 5xx warning alarm — catches sustained moderate issues in 10 min
const alb5xxWarningAlarm = new aws.cloudwatch.MetricAlarm('electric-alb-5xx-warning', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	datapointsToAlarm: 2,
	metricName: 'HTTPCode_ELB_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: alarmThresholds.alb5xxCountWarning,
	treatMissingData: 'notBreaching',
	alarmDescription: `WARNING: Electric SQL ALB 5xx errors above ${alarmThresholds.alb5xxCountWarning}/5min for 10min — sustained elevated errors`,
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const albUnhealthyHostAlarm = new aws.cloudwatch.MetricAlarm('electric-alb-unhealthy-hosts', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'UnHealthyHostCount',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Average',
	threshold: 0,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Electric SQL ALB has unhealthy targets',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// Ephemeral storage utilization alarm (Container Insights)
const storageAlarm = new aws.cloudwatch.MetricAlarm('electric-storage-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'EphemeralStorageUtilized',
	namespace: 'ECS/ContainerInsights',
	period: 300,
	statistic: 'Maximum',
	threshold: alarmThresholds.ephemeralStorageGiB,
	unit: 'Gigabytes',
	alarmDescription: `Electric SQL ephemeral storage above ${alarmThresholds.ephemeralStorageGiB} GiB`,
	dimensions: {
		ClusterName: pulumi.interpolate`${service.service.cluster.apply((c) => c.split('/').pop())}`,
		ServiceName: service.service.name,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// --- Exports ---
export const electricUrl = pulumi.interpolate`https://electric.${domainSuffix}`
export const electricSecretArn = electricConnectionSecret.arn
export const electricSecretValueArn = electricConnectionSecretVersion.arn
export const securityGroupId = electricSecurityGroup.id
export const ecsServiceName = service.service.name
export const electricIngressResources = {
	albLogsBucketPolicyId: albLogsBucketPolicy.id,
	httpsListenerArn: httpsListener.arn,
	dnsRecordFqdn: dnsRecord.fqdn,
}
export const electricAlarmArns = {
	cpu: cpuAlarm.arn,
	memory: memoryAlarm.arn,
	alb5xxCritical: alb5xxAlarm.arn,
	alb5xxWarning: alb5xxWarningAlarm.arn,
	albUnhealthyHosts: albUnhealthyHostAlarm.arn,
	ephemeralStorage: storageAlarm.arn,
}
