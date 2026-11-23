import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

const config = new pulumi.Config()
const instanceClass = config.require('instanceClass')
const replicaInstanceClass = config.require('replicaInstanceClass')
const allocatedStorage = config.requireNumber('allocatedStorage')
const maxAllocatedStorage = config.requireNumber('maxAllocatedStorage')
const multiAz = config.requireBoolean('multiAz')

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

// Security group (identity — no rules yet, downstream services add ingress)
const rdsSecurityGroup = new aws.ec2.SecurityGroup('postgres-sg', {
	description: 'RDS Postgres security group',
	vpcId,
})

// Subnet group
const subnetGroup = new aws.rds.SubnetGroup('postgres-subnets', {
	subnetIds: privateSubnetIds,
})

// Parameter group: logical replication + disable forced SSL
// (RDS certs are non-standard and require manual import into runtimes;
//  traffic is VPC-internal so no TLS is not a security risk)
const parameterGroup = new aws.rds.ParameterGroup('postgres18-params', {
	family: 'postgres18',
	parameters: [
		{ name: 'rds.logical_replication', value: '1', applyMethod: 'pending-reboot' },
		{ name: 'rds.force_ssl', value: '0', applyMethod: 'pending-reboot' },
		// Cap the WAL any single replication slot can force-retain at 10 GB (10240 MB).
		// Guards against a stalled Electric logical slot (e.g. under memory pressure)
		// retaining WAL until the disk fills. If a slot exceeds this, Postgres invalidates
		// it at the next checkpoint, frees the WAL, and Electric recreates the slot and
		// resyncs shapes. This is a dynamic (sighup) GUC, so applyMethod 'immediate' takes
		// effect without a reboot. Value is in MB with no unit suffix.
		{ name: 'max_slot_wal_keep_size', value: '10240', applyMethod: 'immediate' },
	],
})

// Password via @pulumi/random → Secrets Manager
const password = new random.RandomPassword('db-password', {
	length: 64,
	special: false,
	keepers: {},
})
const passwordSecret = new aws.secretsmanager.Secret(
	'db-password',
	{
		name: `rds-postgres/${env}/password`,
	},
	{ deleteBeforeReplace: true },
)
const passwordSecretVersion = new aws.secretsmanager.SecretVersion('db-password-value', {
	secretId: passwordSecret.id,
	secretString: password.result,
})

// Primary RDS instance
const primary = new aws.rds.Instance(
	'postgres',
	{
		identifier: `riptide-postgres-${env}`,
		engine: 'postgres',
		engineVersion: '18.3',
		instanceClass,
		allocatedStorage,
		maxAllocatedStorage,
		storageType: 'gp3',
		storageEncrypted: true,
		dbName: 'electric',
		username: 'postgres',
		password: password.result,
		multiAz,
		dbSubnetGroupName: subnetGroup.name,
		parameterGroupName: parameterGroup.name,
		vpcSecurityGroupIds: [rdsSecurityGroup.id],
		deletionProtection: true,
		backupRetentionPeriod: 7,
		skipFinalSnapshot: false,
		finalSnapshotIdentifier: pulumi.interpolate`riptide-postgres-${env}-final`,
		tags: adminCliDiscoveryTags('rds-primary'),
	},
	{ protect: env !== 'dev' },
)

// Read replica
const replica = new aws.rds.Instance('postgres-replica', {
	identifier: `riptide-postgres-${env}-replica`,
	replicateSourceDb: primary.identifier,
	instanceClass: replicaInstanceClass,
	maxAllocatedStorage,
	storageEncrypted: true,
	vpcSecurityGroupIds: [rdsSecurityGroup.id],
	skipFinalSnapshot: true,
	tags: adminCliDiscoveryTags('rds-replica'),
})

// Connection URL secret (primary)
const connectionUrlSecret = new aws.secretsmanager.Secret(
	'connection-url',
	{
		name: `rds-postgres/${env}/connection-url`,
	},
	{ deleteBeforeReplace: true },
)
const connectionUrlSecretVersion = new aws.secretsmanager.SecretVersion('connection-url-value', {
	secretId: connectionUrlSecret.id,
	secretString: pulumi.interpolate`postgresql://${primary.username}:${password.result}@${primary.address}:${primary.port}/${primary.dbName}`,
})

// Connection URL secret (read replica)
const readReplicaConnectionUrlSecret = new aws.secretsmanager.Secret(
	'read-replica-connection-url',
	{
		name: `rds-postgres/${env}/read-replica-connection-url`,
		tags: adminCliDiscoveryTags('rds-replica-connection-secret'),
	},
	{ deleteBeforeReplace: true },
)
const readReplicaConnectionUrlSecretVersion = new aws.secretsmanager.SecretVersion(
	'read-replica-connection-url-value',
	{
		secretId: readReplicaConnectionUrlSecret.id,
		secretString: pulumi.interpolate`postgresql://${primary.username}:${password.result}@${replica.address}:${replica.port}/${primary.dbName}`,
	},
)

// CloudWatch alarms (CPU, connections, storage, memory, IO, replica lag)
const cpuAlarm = new aws.cloudwatch.MetricAlarm('postgres-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Primary RDS CPU utilization over 80%',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const replicaCpuAlarm = new aws.cloudwatch.MetricAlarm('postgres-replica-cpu-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'CPUUtilization',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Read replica RDS CPU utilization over 80%',
	dimensions: {
		DBInstanceIdentifier: replica.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const connectionAlarm = new aws.cloudwatch.MetricAlarm('postgres-connections-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'DatabaseConnections',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 80,
	alarmDescription: 'Primary RDS database connections high',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const storageAlarm = new aws.cloudwatch.MetricAlarm('postgres-storage-low', {
	comparisonOperator: 'LessThanThreshold',
	evaluationPeriods: 1,
	metricName: 'FreeStorageSpace',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 10737418240, // 10 GB in bytes
	alarmDescription: 'Primary RDS free storage space below 10 GB',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const replicaStorageAlarm = new aws.cloudwatch.MetricAlarm('postgres-replica-storage-low', {
	comparisonOperator: 'LessThanThreshold',
	evaluationPeriods: 1,
	metricName: 'FreeStorageSpace',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 10737418240, // 10 GB in bytes
	alarmDescription: 'Read replica RDS free storage space below 10 GB',
	dimensions: {
		DBInstanceIdentifier: replica.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const memoryAlarm = new aws.cloudwatch.MetricAlarm('postgres-memory-low', {
	comparisonOperator: 'LessThanThreshold',
	evaluationPeriods: 1,
	metricName: 'FreeableMemory',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 536870912, // 512 MB in bytes
	alarmDescription: 'Primary RDS freeable memory below 512 MB',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const replicaMemoryAlarm = new aws.cloudwatch.MetricAlarm('postgres-replica-memory-low', {
	comparisonOperator: 'LessThanThreshold',
	evaluationPeriods: 1,
	metricName: 'FreeableMemory',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 536870912, // 512 MB in bytes
	alarmDescription: 'Read replica RDS freeable memory below 512 MB',
	dimensions: {
		DBInstanceIdentifier: replica.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const diskQueueDepthAlarm = new aws.cloudwatch.MetricAlarm('postgres-disk-queue-depth-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'DiskQueueDepth',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 64,
	alarmDescription: 'Primary RDS disk queue depth over 64',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const replicaDiskQueueDepthAlarm = new aws.cloudwatch.MetricAlarm('postgres-replica-disk-queue-depth-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'DiskQueueDepth',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 64,
	alarmDescription: 'Read replica RDS disk queue depth over 64',
	dimensions: {
		DBInstanceIdentifier: replica.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const replicaLagAlarm = new aws.cloudwatch.MetricAlarm('postgres-replica-lag-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 2,
	metricName: 'ReplicaLag',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Average',
	threshold: 30000, // 30 seconds in milliseconds
	alarmDescription: 'Read replica lag over 30 seconds',
	dimensions: {
		DBInstanceIdentifier: replica.identifier,
	},
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

const walDiskUsageAlarm = new aws.cloudwatch.MetricAlarm('postgres-wal-disk-usage-high', {
	comparisonOperator: 'GreaterThanThreshold',
	evaluationPeriods: 3,
	datapointsToAlarm: 3,
	metricName: 'TransactionLogsDiskUsage',
	namespace: 'AWS/RDS',
	period: 300,
	statistic: 'Maximum',
	threshold: 5 * 1024 * 1024 * 1024, // 5 GB in bytes
	alarmDescription:
		'WAL disk usage over 5 GB — replication slot may be stalled or logical replication falling behind',
	dimensions: {
		DBInstanceIdentifier: primary.identifier,
	},
	treatMissingData: 'notBreaching',
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// Exports
export const securityGroupId = rdsSecurityGroup.id
export const connectionUrlSecretArn = connectionUrlSecret.arn
export const connectionUrlSecretValueArn = connectionUrlSecretVersion.arn
export const readReplicaConnectionUrlSecretArn = readReplicaConnectionUrlSecret.arn
export const readReplicaConnectionUrlSecretValueArn = readReplicaConnectionUrlSecretVersion.arn
export const passwordSecretArn = passwordSecret.arn
export const passwordSecretValueArn = passwordSecretVersion.arn
export const primaryEndpoint = primary.address
export const replicaEndpoint = replica.address
export const rdsAlarmArns = {
	primaryCpu: cpuAlarm.arn,
	replicaCpu: replicaCpuAlarm.arn,
	primaryConnections: connectionAlarm.arn,
	primaryStorage: storageAlarm.arn,
	replicaStorage: replicaStorageAlarm.arn,
	primaryMemory: memoryAlarm.arn,
	replicaMemory: replicaMemoryAlarm.arn,
	primaryDiskQueueDepth: diskQueueDepthAlarm.arn,
	replicaDiskQueueDepth: replicaDiskQueueDepthAlarm.arn,
	replicaLag: replicaLagAlarm.arn,
	primaryWalDiskUsage: walDiskUsageAlarm.arn,
}
