import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const dnsZone = config.require('dnsZone')
const domainSuffix = config.require('domainSuffix')
const stack = pulumi.getStack()

// --- VPC ---
const vpc = new awsx.ec2.Vpc('codelayer-vpc', {
	numberOfAvailabilityZones: 2,
	natGateways: { strategy: awsx.ec2.NatGatewayStrategy.Single },
	enableDnsHostnames: true,
	enableDnsSupport: true,
})

if (stack === 'beta' || stack === 'prod') {
	const vpcFlowLogsLogGroup = new aws.cloudwatch.LogGroup('vpc-flow-logs', {
		name: `/aws/vpc-flow-logs/codelayer-vpc-${stack}`,
		retentionInDays: 365,
	})

	const vpcFlowLogsRole = new aws.iam.Role('vpc-flow-logs', {
		assumeRolePolicy: JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Principal: { Service: 'vpc-flow-logs.amazonaws.com' },
					Action: 'sts:AssumeRole',
				},
			],
		}),
	})

	new aws.iam.RolePolicy('vpc-flow-logs-cloudwatch', {
		role: vpcFlowLogsRole.id,
		policy: vpcFlowLogsLogGroup.arn.apply((logGroupArn) =>
			JSON.stringify({
				Version: '2012-10-17',
				Statement: [
					{
						Effect: 'Allow',
						Action: [
							'logs:CreateLogStream',
							'logs:PutLogEvents',
							'logs:DescribeLogGroups',
							'logs:DescribeLogStreams',
						],
						Resource: `${logGroupArn}:*`,
					},
				],
			}),
		),
	})

	new aws.ec2.FlowLog('codelayer-vpc-flow-logs', {
		vpcId: vpc.vpcId,
		trafficType: 'ALL',
		logDestinationType: 'cloud-watch-logs',
		logDestination: vpcFlowLogsLogGroup.arn,
		iamRoleArn: vpcFlowLogsRole.arn,
	})
}

// --- ECS Cluster ---
const ecsCluster = new aws.ecs.Cluster('codelayer-cluster', {
	settings: [{ name: 'containerInsights', value: 'enhanced' }],
})

// Container Insights performance logs, kept for a year. (HumanLayer's own copy of this stack
// imports log groups AWS had already created in its accounts; this copy just creates them.)
const _containerInsightsLogGroup = new aws.cloudwatch.LogGroup('ecs-containerinsights-performance-logs', {
	name: pulumi.interpolate`/aws/ecs/containerinsights/${ecsCluster.name}/performance`,
	retentionInDays: 365,
})

// --- DNS Zone Lookup (does NOT create the zone) ---
const zone = await aws.route53.getZone({ name: dnsZone, privateZone: false })

// --- Wildcard ACM Certificate ---
const certificate = new aws.acm.Certificate('wildcard-cert', {
	domainName: `*.${domainSuffix}`,
	validationMethod: 'DNS',
})

const validationRecord = new aws.route53.Record('cert-validation', {
	zoneId: zone.zoneId,
	name: certificate.domainValidationOptions[0].resourceRecordName,
	type: certificate.domainValidationOptions[0].resourceRecordType,
	records: [certificate.domainValidationOptions[0].resourceRecordValue],
	ttl: 60,
	allowOverwrite: true,
})

const certificateValidation = new aws.acm.CertificateValidation('cert-validation-waiter', {
	certificateArn: certificate.arn,
	validationRecordFqdns: [validationRecord.fqdn],
})

// --- SNS Alarm Topic ---
const alarmTopic = new aws.sns.Topic('alarm-notifications', {
	name: `alarm-notifications-${stack}`,
})

// --- Cloud Map Namespace for ECS Service Discovery ---
const serviceDiscoveryNamespaceName = config.require('serviceDiscoveryNamespace')
const serviceDiscoveryNamespace = new aws.servicediscovery.PrivateDnsNamespace('service-discovery-ns', {
	name: serviceDiscoveryNamespaceName,
	vpc: vpc.vpcId,
	description: 'Private DNS namespace for ECS service discovery',
})

// --- ECR Pull-Through Cache lifecycle policy (shared) ---
const pullThroughLifecyclePolicy = JSON.stringify({
	rules: [
		{
			rulePriority: 1,
			description: 'Expire untagged images after 30 days',
			selection: {
				tagStatus: 'untagged',
				countType: 'sinceImagePushed',
				countUnit: 'days',
				countNumber: 30,
			},
			action: { type: 'expire' },
		},
	],
})

// --- ECR Pull-Through Cache for Docker Hub ---
const dockerHubUsername = config.requireSecret('dockerHubUsername')
const dockerHubAccessToken = config.requireSecret('dockerHubAccessToken')
const dockerHubPrefix = `docker-hub-${stack}`

const dockerHubCacheSecret = new aws.secretsmanager.Secret(
	'ecr-dockerhub-credentials',
	{
		name: `ecr-pullthroughcache/docker-hub-${stack}`,
	},
	{ deleteBeforeReplace: true },
)

const dockerHubCacheSecretVersion = new aws.secretsmanager.SecretVersion('ecr-dockerhub-credentials-value', {
	secretId: dockerHubCacheSecret.id,
	secretString: pulumi
		.all([dockerHubUsername, dockerHubAccessToken])
		.apply(([username, accessToken]) => JSON.stringify({ username, accessToken })),
})

const dockerHubCacheRule = new aws.ecr.PullThroughCacheRule(
	'docker-hub-cache',
	{
		ecrRepositoryPrefix: dockerHubPrefix,
		upstreamRegistryUrl: 'registry-1.docker.io',
		credentialArn: dockerHubCacheSecret.arn,
	},
	{ dependsOn: [dockerHubCacheSecretVersion] },
)

const dockerHubRepoTemplate = new aws.ecr.RepositoryCreationTemplate('docker-hub-repo-template', {
	prefix: dockerHubPrefix,
	appliedFors: ['PULL_THROUGH_CACHE'],
	imageTagMutability: 'MUTABLE',
	lifecyclePolicy: pullThroughLifecyclePolicy,
})

// --- ECR Pull-Through Cache for GitHub Container Registry ---
const ghcrUsername = config.requireSecret('ghcrUsername')
const ghcrAccessToken = config.requireSecret('ghcrAccessToken')
const ghcrPrefix = `ghcr-${stack}`

const ghcrCacheSecret = new aws.secretsmanager.Secret(
	'ecr-ghcr-credentials',
	{
		name: `ecr-pullthroughcache/ghcr-${stack}`,
	},
	{ deleteBeforeReplace: true },
)

const ghcrCacheSecretVersion = new aws.secretsmanager.SecretVersion('ecr-ghcr-credentials-value', {
	secretId: ghcrCacheSecret.id,
	secretString: pulumi
		.all([ghcrUsername, ghcrAccessToken])
		.apply(([username, accessToken]) => JSON.stringify({ username, accessToken })),
})

const ghcrCacheRule = new aws.ecr.PullThroughCacheRule(
	'ghcr-cache',
	{
		ecrRepositoryPrefix: ghcrPrefix,
		upstreamRegistryUrl: 'ghcr.io',
		credentialArn: ghcrCacheSecret.arn,
	},
	{ dependsOn: [ghcrCacheSecretVersion] },
)

const ghcrRepoTemplate = new aws.ecr.RepositoryCreationTemplate('ghcr-repo-template', {
	prefix: ghcrPrefix,
	appliedFors: ['PULL_THROUGH_CACHE'],
	imageTagMutability: 'MUTABLE',
	lifecyclePolicy: pullThroughLifecyclePolicy,
})

// --- Exports ---
export const vpcId = vpc.vpcId
export const privateSubnetIds = vpc.privateSubnetIds
export const publicSubnetIds = vpc.publicSubnetIds
export const ecsClusterArn = ecsCluster.arn
export const ecsClusterId = ecsCluster.id
export const validatedCertificateArn = certificateValidation.certificateArn
export const hostedZoneId = zone.zoneId
export { domainSuffix }
export const alarmTopicArn = alarmTopic.arn
export const servicediscoveryNamespaceId = serviceDiscoveryNamespace.id
export const servicediscoveryNamespaceName = serviceDiscoveryNamespace.name
export const ecrDockerHubPrefix = pulumi.output(dockerHubPrefix)
export const ecrGhcrPrefix = pulumi.output(ghcrPrefix)
export const ecrPullThroughCacheResourceIds = {
	dockerHub: {
		rule: dockerHubCacheRule.id,
		repositoryTemplate: dockerHubRepoTemplate.id,
	},
	ghcr: {
		rule: ghcrCacheRule.id,
		repositoryTemplate: ghcrRepoTemplate.id,
	},
}
// Keep for backwards compat during migration - existing stacks reference this
export const ecrRepositoryPrefix = pulumi.output(dockerHubPrefix)
