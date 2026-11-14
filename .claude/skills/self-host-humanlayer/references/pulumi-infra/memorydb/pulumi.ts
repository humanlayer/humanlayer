import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

const config = new pulumi.Config()
const nodeType = config.require('nodeType')
const numReplicasPerShard = config.requireNumber('numReplicasPerShard')
const snapshotRetentionLimit = config.requireNumber('snapshotRetentionLimit')
const maintenanceWindow = config.require('maintenanceWindow')
const snapshotWindow = config.require('snapshotWindow')
const memorydbPort = config.requireNumber('port')
const parameterGroupFamily = config.require('parameterGroupFamily')
const userName = config.require('userName')

const env = pulumi.getStack()

function adminCliDiscoveryTags(resource: string) {
	return {
		HumanlayerPulumiManaged: 'true',
		HumanlayerPulumiEnvironment: env,
		HumanlayerPulumiLocatable: 'true',
		HumanlayerPulumiResource: resource,
	}
}

const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>

const securityGroup = new aws.ec2.SecurityGroup('memorydb-sg', {
	description: 'MemoryDB security group',
	vpcId,
})

const subnetGroup = new aws.memorydb.SubnetGroup('memorydb-subnet-group', {
	description: `MemoryDB subnet group for ${env}`,
	name: `riptide-memorydb-${env}`,
	subnetIds: privateSubnetIds,
})

const parameterGroup = new aws.memorydb.ParameterGroup('memorydb-parameter-group', {
	description: `MemoryDB parameter group for ${env}`,
	family: parameterGroupFamily,
	name: `riptide-memorydb-${env}`,
	parameters: [
		{ name: 'activedefrag', value: 'yes' },
		{ name: 'notify-keyspace-events', value: 'AKE' },
	],
})

const password = new random.RandomPassword('memorydb-password', {
	length: 32,
	special: false,
	keepers: {},
})

const passwordSecret = new aws.secretsmanager.Secret(
	'memorydb-password',
	{
		name: `memorydb/${env}/password`,
	},
	{ deleteBeforeReplace: true },
)

const passwordSecretVersion = new aws.secretsmanager.SecretVersion('memorydb-password-value', {
	secretId: passwordSecret.id,
	secretString: password.result,
})

const user = new aws.memorydb.User('memorydb-user', {
	accessString: 'on ~* &* +@all',
	authenticationMode: {
		passwords: [password.result],
		type: 'password',
	},
	userName,
})

const acl = new aws.memorydb.Acl('memorydb-acl', {
	name: `riptide-memorydb-${env}`,
	userNames: [user.userName],
})

const cluster = new aws.memorydb.Cluster(
	'memorydb',
	{
		aclName: acl.name,
		autoMinorVersionUpgrade: true,
		description: `Redis-compatible billing KV for ${env}`,
		engine: 'redis',
		engineVersion: '7.1',
		maintenanceWindow,
		name: `riptide-memorydb-${env}`,
		nodeType,
		numReplicasPerShard,
		numShards: 1,
		parameterGroupName: parameterGroup.name,
		port: memorydbPort,
		securityGroupIds: [securityGroup.id],
		snapshotRetentionLimit,
		snapshotWindow,
		snsTopicArn: alarmTopicArn,
		subnetGroupName: subnetGroup.name,
		tlsEnabled: true,
		tags: adminCliDiscoveryTags('memorydb'),
	},
	{ dependsOn: [acl] },
)

const primaryEndpoint = cluster.clusterEndpoints.apply((endpoints) => endpoints[0]?.address ?? '')
const clusterReaderEndpoint = cluster.clusterEndpoints.apply(
	(endpoints) => endpoints[1]?.address ?? endpoints[0]?.address ?? '',
)

const connectionUrlSecret = new aws.secretsmanager.Secret(
	'connection-url',
	{
		name: `memorydb/${env}/connection-url`,
		tags: adminCliDiscoveryTags('memorydb-connection-secret'),
	},
	{ deleteBeforeReplace: true },
)

const connectionUrlSecretVersion = new aws.secretsmanager.SecretVersion('connection-url-value', {
	secretId: connectionUrlSecret.id,
	secretString: pulumi.interpolate`rediss://${user.userName}:${password.result}@${primaryEndpoint}:${cluster.port}`,
})

const cpuAlarm = new aws.cloudwatch.MetricAlarm('memorydb-cpu-high', {
	alarmActions: [alarmTopicArn],
	alarmDescription: 'MemoryDB CPU utilization over 80%',
	comparisonOperator: 'GreaterThanThreshold',
	dimensions: {
		ClusterName: cluster.name,
	},
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/MemoryDB',
	okActions: [alarmTopicArn],
	period: 300,
	statistic: 'Average',
	threshold: 80,
})

const freeableMemoryAlarm = new aws.cloudwatch.MetricAlarm('memorydb-freeable-memory-low', {
	alarmActions: [alarmTopicArn],
	alarmDescription: 'MemoryDB freeable memory below 256 MB',
	comparisonOperator: 'LessThanThreshold',
	dimensions: {
		ClusterName: cluster.name,
	},
	evaluationPeriods: 2,
	metricName: 'FreeableMemory',
	namespace: 'AWS/MemoryDB',
	okActions: [alarmTopicArn],
	period: 300,
	statistic: 'Average',
	threshold: 268435456,
})

const connectionsAlarm = new aws.cloudwatch.MetricAlarm('memorydb-connections-high', {
	alarmActions: [alarmTopicArn],
	alarmDescription: 'MemoryDB concurrent connections are high',
	comparisonOperator: 'GreaterThanThreshold',
	dimensions: {
		ClusterName: cluster.name,
	},
	evaluationPeriods: 2,
	metricName: 'CurrConnections',
	namespace: 'AWS/MemoryDB',
	okActions: [alarmTopicArn],
	period: 300,
	statistic: 'Average',
	threshold: 1000,
})

const replicationLagAlarm = new aws.cloudwatch.MetricAlarm('memorydb-replication-lag-high', {
	alarmActions: [alarmTopicArn],
	alarmDescription: 'MemoryDB replication lag over one second',
	comparisonOperator: 'GreaterThanThreshold',
	dimensions: {
		ClusterName: cluster.name,
	},
	evaluationPeriods: 2,
	metricName: 'ReplicationLag',
	namespace: 'AWS/MemoryDB',
	okActions: [alarmTopicArn],
	period: 300,
	statistic: 'Maximum',
	threshold: 1000,
	treatMissingData: 'notBreaching',
})

export const securityGroupId = securityGroup.id
export const aclName = acl.name
export const clusterArn = cluster.arn
export const clusterEndpoint = primaryEndpoint
export const readerEndpoint = clusterReaderEndpoint
export const port = cluster.port
export const userNameOutput = user.userName
export const passwordSecretArn = passwordSecret.arn
export const passwordSecretValueArn = passwordSecretVersion.arn
export const connectionUrlSecretArn = connectionUrlSecret.arn
export const connectionUrlSecretValueArn = connectionUrlSecretVersion.arn
export const memorydbAlarmArns = {
	cpu: cpuAlarm.arn,
	freeableMemory: freeableMemoryAlarm.arn,
	connections: connectionsAlarm.arn,
	replicationLag: replicationLagAlarm.arn,
}
