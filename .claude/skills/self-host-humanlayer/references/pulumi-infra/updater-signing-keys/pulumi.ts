import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const env = pulumi.getStack()
const config = new pulumi.Config()

// Keys are pre-generated with `tauri signer generate --ci` and stored in Pulumi config:
//   pulumi config set --secret privateKey "..."
//   pulumi config set publicKey "..."
const privateKey = config.requireSecret('privateKey')
const publicKey = config.require('publicKey')

// --- Secrets Manager: Private Key ---
const privateKeySecret = new aws.secretsmanager.Secret(
	'updater-signing-private-key',
	{
		name: `updater-signing-keys/${env}/private-key`,
	},
	{ deleteBeforeReplace: true },
)
const privateKeySecretVersion = new aws.secretsmanager.SecretVersion(
	'updater-signing-private-key-value',
	{
		secretId: privateKeySecret.id,
		secretString: privateKey,
	},
	{ dependsOn: [privateKeySecret] },
)

// --- Secrets Manager: Public Key ---
const publicKeySecret = new aws.secretsmanager.Secret(
	'updater-signing-public-key',
	{
		name: `updater-signing-keys/${env}/public-key`,
	},
	{ deleteBeforeReplace: true },
)
const publicKeySecretVersion = new aws.secretsmanager.SecretVersion(
	'updater-signing-public-key-value',
	{
		secretId: publicKeySecret.id,
		secretString: publicKey,
	},
	{ dependsOn: [publicKeySecret] },
)

// --- Exports ---
export const privateKeySecretArn = privateKeySecret.arn
export const privateKeySecretValueArn = privateKeySecretVersion.arn
export const publicKeySecretArn = publicKeySecret.arn
export const publicKeySecretValueArn = publicKeySecretVersion.arn
