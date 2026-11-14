import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as tls from '@pulumi/tls'

const env = pulumi.getStack()

// --- RSA Key Pair for daemon token signing/verification ---
const keyPair = new tls.PrivateKey('daemon-token-key', {
	algorithm: 'RSA',
	rsaBits: 2048,
})

// Base64-encode the PEM keys for storage in Secrets Manager
// (the daemon/api/proxy code decodes base64 env vars at runtime)
const publicKeyBase64 = keyPair.publicKeyPem.apply((pem) => Buffer.from(pem).toString('base64'))
const privateKeyBase64 = keyPair.privateKeyPemPkcs8.apply((pem) => Buffer.from(pem).toString('base64'))

// --- Secrets Manager: Public Key ---
const publicKeySecret = new aws.secretsmanager.Secret(
	'daemon-token-public-key',
	{
		name: `daemon-token-keys/${env}/public-key`,
	},
	{ deleteBeforeReplace: true },
)
const publicKeySecretVersion = new aws.secretsmanager.SecretVersion('daemon-token-public-key-value', {
	secretId: publicKeySecret.id,
	secretString: publicKeyBase64,
})

// --- Secrets Manager: Private Key ---
const privateKeySecret = new aws.secretsmanager.Secret(
	'daemon-token-private-key',
	{
		name: `daemon-token-keys/${env}/private-key`,
	},
	{ deleteBeforeReplace: true },
)
const privateKeySecretVersion = new aws.secretsmanager.SecretVersion('daemon-token-private-key-value', {
	secretId: privateKeySecret.id,
	secretString: privateKeyBase64,
})

// --- Exports ---
export const publicKeySecretArn = publicKeySecret.arn
export const publicKeySecretValueArn = publicKeySecretVersion.arn
export const privateKeySecretArn = privateKeySecret.arn
export const privateKeySecretValueArn = privateKeySecretVersion.arn
