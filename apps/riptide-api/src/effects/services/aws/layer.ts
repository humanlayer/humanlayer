import { Credentials, Region } from '@distilled.cloud/aws'
import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

export const AwsLive = Layer.mergeAll(FetchHttpClient.layer, Credentials.fromChain(), Region.fromEnv())
