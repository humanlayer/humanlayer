import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'

interface FargateConfig {
	cpu: number
	memory: number
}

interface AlarmThresholds {
	cpuPercent: number
	memoryPercent: number
	alb5xxCount: number
	albTarget5xxCount: number
	ephemeralStorageGiB: number
}

interface AlbLogsConfig {
	retentionDays: number
}

const serverPort = 4437
const desiredCount = 1
const maxFargateEphemeralStorageGiB = 200
const globalQuotaBytes = 187_904_819_200
const streamQuotaBytes = 104_857_600

const config = new pulumi.Config()
const env = pulumi.getStack()
const fargate = config.requireObject<FargateConfig>('fargate')
const imageTag = config.require('imageTag')
const alarmThresholds = config.requireObject<AlarmThresholds>('alarmThresholds')
const albLogs = config.requireObject<AlbLogsConfig>('albLogs')

if (!['dev', 'beta', 'prod'].includes(env)) {
	throw new Error(`unsupported rust-durable-streams stack: ${env}`)
}

const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const registryStack = new pulumi.StackReference(`humanlayer/rust-durable-streams-registry/${env}`)

const ecsClusterArn = coreStack.requireOutput('ecsClusterArn')
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>
const repositoryUrl = registryStack.requireOutput('repositoryUrl') as pulumi.Output<string>

const elbServiceAccount = aws.elb.getServiceAccountOutput()

const albLogsBucket = new aws.s3.Bucket('rust-durable-streams-alb-logs', {
	forceDestroy: true,
})

new aws.s3.BucketLifecycleConfigurationV2('rust-durable-streams-alb-logs-lifecycle', {
	bucket: albLogsBucket.id,
	rules: [
		{
			id: 'expire-alb-access-logs',
			status: 'Enabled',
			filter: { prefix: 'rust-durable-streams-alb/' },
			expiration: { days: albLogs.retentionDays },
			abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
		},
	],
})

const albLogsBucketPolicy = new aws.s3.BucketPolicy('rust-durable-streams-alb-logs-policy', {
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

const loadBalancer = new awsx.lb.ApplicationLoadBalancer('rust-durable-streams-alb', {
	// AWS load balancer names are limited to 32 characters. The AWSX-generated
	// name from this component's long logical name exceeds that limit.
	name: `rust-ds-${env}-alb`,
	internal: true,
	subnetIds: privateSubnetIds,
	idleTimeout: 3600,
	accessLogs: {
		enabled: true,
		bucket: albLogsBucket.id,
		prefix: 'rust-durable-streams-alb',
	},
	defaultTargetGroup: {
		// AWS target group names are limited to 32 characters. The AWSX-generated
		// name from this component's long logical name exceeds that limit.
		name: `rust-ds-${env}`,
		port: serverPort,
		protocol: 'HTTP',
		deregistrationDelay: 30,
		healthCheck: {
			enabled: true,
			path: '/readyz',
			protocol: 'HTTP',
			matcher: '200-299',
			interval: 10,
			timeout: 5,
			healthyThreshold: 2,
			unhealthyThreshold: 3,
		},
	},
})

const httpsListener = new aws.lb.Listener('rust-durable-streams-https-listener', {
	loadBalancerArn: loadBalancer.loadBalancer.arn,
	port: 443,
	protocol: 'HTTPS',
	certificateArn: validatedCertificateArn,
	defaultActions: [{ type: 'forward', targetGroupArn: loadBalancer.defaultTargetGroup.arn }],
})

const dnsRecord = new aws.route53.Record('rust-durable-streams-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`durable-streams.${domainSuffix}`,
	type: 'A',
	aliases: [
		{
			name: loadBalancer.loadBalancer.dnsName,
			zoneId: loadBalancer.loadBalancer.zoneId,
			evaluateTargetHealth: true,
		},
	],
})

const serviceSecurityGroup = new aws.ec2.SecurityGroup('rust-durable-streams-sg', {
	description: 'Rust Durable Streams ECS tasks',
	vpcId,
	ingress: [
		{
			protocol: 'tcp',
			fromPort: serverPort,
			toPort: serverPort,
			securityGroups: loadBalancer.loadBalancer.securityGroups,
		},
	],
	egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
})

const ecsExecPolicy = JSON.stringify({
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
})

const service = new awsx.ecs.FargateService(
	'rust-durable-streams',
	{
		cluster: ecsClusterArn,
		desiredCount,
		// A singleton uses task-local storage. Never overlap old and new tasks with
		// independent filesystems; accepting deployment downtime is intentional.
		deploymentMinimumHealthyPercent: 0,
		deploymentMaximumPercent: 100,
		enableExecuteCommand: true,
		healthCheckGracePeriodSeconds: 60,
		deploymentCircuitBreaker: { enable: true, rollback: true },
		taskDefinitionArgs: {
			runtimePlatform: {
				cpuArchitecture: 'ARM64',
				operatingSystemFamily: 'LINUX',
			},
			logGroup: { args: { retentionInDays: 365 } },
			family: `rust-durable-streams-${env}`,
			skipDestroy: true,
			cpu: String(fargate.cpu),
			memory: String(fargate.memory),
			ephemeralStorage: { sizeInGib: maxFargateEphemeralStorageGiB },
			container: {
				name: 'rust-durable-streams',
				image: pulumi.interpolate`${repositoryUrl}:${imageTag}`,
				cpu: fargate.cpu,
				memory: fargate.memory,
				essential: true,
				stopTimeout: 120,
				portMappings: [
					{
						containerPort: serverPort,
						hostPort: serverPort,
						targetGroup: loadBalancer.defaultTargetGroup,
					},
				],
				environment: [
					{ name: 'DS_SERVER__BIND_ADDRESS', value: `0.0.0.0:${serverPort}` },
					{ name: 'DS_STORAGE__MODE', value: 'file-fast' },
					{ name: 'DS_STORAGE__DATA_DIR', value: '/var/lib/durable-streams' },
					{ name: 'DS_HTTP__ALLOW_WILDCARD_CORS', value: 'true' },
					{ name: 'DS_LIMITS__MAX_MEMORY_BYTES', value: String(globalQuotaBytes) },
					{ name: 'DS_LIMITS__MAX_STREAM_BYTES', value: String(streamQuotaBytes) },
					{ name: 'DS_LIMITS__MAX_STREAM_NAME_SEGMENTS', value: '256' },
					{ name: 'RUST_LOG', value: 'info' },
				],
				healthCheck: {
					command: [
						'CMD',
						'curl',
						'--fail',
						'--silent',
						'--show-error',
						`http://localhost:${serverPort}/healthz`,
					],
					interval: 30,
					timeout: 5,
					retries: 3,
					startPeriod: 10,
				},
			},
			taskRole: {
				args: {
					inlinePolicies: [{ name: 'ecs-exec', policy: ecsExecPolicy }],
				},
			},
		},
		networkConfiguration: {
			assignPublicIp: false,
			securityGroups: [serviceSecurityGroup.id],
			subnets: privateSubnetIds,
		},
	},
	{ dependsOn: [httpsListener, albLogsBucketPolicy] },
)

const clusterName = service.service.cluster.apply((cluster) => {
	const name = cluster.split('/').pop()
	if (name === undefined) throw new Error(`malformed cluster ARN: ${cluster}`)
	return name
})

const cpuAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Maximum',
	threshold: alarmThresholds.cpuPercent,
	alarmDescription: 'Rust Durable Streams CPU utilization is high',
	dimensions: { ClusterName: clusterName, ServiceName: service.service.name },
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const memoryAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-memory-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'MemoryUtilization',
	namespace: 'AWS/ECS',
	period: 300,
	statistic: 'Average',
	threshold: alarmThresholds.memoryPercent,
	alarmDescription: 'Rust Durable Streams memory utilization is high',
	dimensions: { ClusterName: clusterName, ServiceName: service.service.name },
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const storageAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-storage-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'EphemeralStorageUtilized',
	namespace: 'ECS/ContainerInsights',
	period: 300,
	statistic: 'Maximum',
	threshold: alarmThresholds.ephemeralStorageGiB,
	unit: 'Gigabytes',
	alarmDescription: `Rust Durable Streams ephemeral storage exceeds ${alarmThresholds.ephemeralStorageGiB} GiB`,
	dimensions: { ClusterName: clusterName, ServiceName: service.service.name },
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const alb5xxAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-alb-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 1,
	metricName: 'HTTPCode_ELB_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: alarmThresholds.alb5xxCount,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Rust Durable Streams ALB-generated 5xx responses are elevated',
	dimensions: { LoadBalancer: loadBalancer.loadBalancer.arnSuffix },
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const target5xxAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-target-5xx', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 1,
	metricName: 'HTTPCode_Target_5XX_Count',
	namespace: 'AWS/ApplicationELB',
	period: 300,
	statistic: 'Sum',
	threshold: alarmThresholds.albTarget5xxCount,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Rust Durable Streams target 5xx responses are elevated',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const unhealthyHostsAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-alb-unhealthy-hosts', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'UnHealthyHostCount',
	namespace: 'AWS/ApplicationELB',
	period: 60,
	statistic: 'Maximum',
	threshold: 0,
	treatMissingData: 'notBreaching',
	alarmDescription: 'Rust Durable Streams ALB has unhealthy targets',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const zeroHealthyHostsAlarm = new aws.cloudwatch.MetricAlarm('rust-durable-streams-alb-zero-healthy-hosts', {
	comparisonOperator: 'LessThanThreshold',
	evaluationPeriods: 2,
	metricName: 'HealthyHostCount',
	namespace: 'AWS/ApplicationELB',
	period: 60,
	statistic: 'Minimum',
	threshold: 1,
	treatMissingData: 'breaching',
	alarmDescription: 'Rust Durable Streams ALB has no healthy targets',
	dimensions: {
		LoadBalancer: loadBalancer.loadBalancer.arnSuffix,
		TargetGroup: loadBalancer.defaultTargetGroup.arnSuffix,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

export const durableStreamsUrl = pulumi.interpolate`https://${dnsRecord.name}`
export const securityGroupId = serviceSecurityGroup.id
export const albSecurityGroupId = loadBalancer.loadBalancer.securityGroups.apply((groups) => groups[0] ?? '')
export const ecsServiceName = service.service.name
export const ephemeralStorageGiB = maxFargateEphemeralStorageGiB
export const alarmArns = {
	cpu: cpuAlarm.arn,
	memory: memoryAlarm.arn,
	ephemeralStorage: storageAlarm.arn,
	alb5xx: alb5xxAlarm.arn,
	target5xx: target5xxAlarm.arn,
	unhealthyHosts: unhealthyHostsAlarm.arn,
	zeroHealthyHosts: zeroHealthyHostsAlarm.arn,
}
