#!/usr/bin/env bun
// humanlayer-opencode login | logout | status [channel], for a shell: a headless machine, or a
// login before opencode first runs. In opencode, /humanlayer login does the same.

import { createInterface } from 'node:readline/promises'

import type { OrgChoice } from '@humanlayer/session-sdk-auth'
import { ALL_CHANNELS, type Channel, errorMessage, isChannel } from '@humanlayer/session-sdk-base'

import { client, login } from './config.ts'

async function pickOrg(orgs: OrgChoice[], current: OrgChoice | undefined): Promise<OrgChoice | undefined> {
	orgs.forEach((org, i) => {
		console.log(`  ${i + 1}. ${org.organizationName}${org === current ? ' (current)' : ''}`)
	})
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	try {
		const answer = (await rl.question('Organization number: ')).trim()
		if (!answer) return current ?? orgs[0]
		return orgs[Number.parseInt(answer, 10) - 1]
	} finally {
		rl.close()
	}
}

async function main(): Promise<void> {
	const [command = 'status', arg] = process.argv.slice(2)
	if (arg !== undefined && !isChannel(arg))
		throw new Error(`unknown channel "${arg}": use ${ALL_CHANNELS.join(', ')}`)
	const channel: Channel = arg ?? (await client.resolveChannel())

	if (command === 'login') {
		// The login waits on unref'd timers, so something must hold the process open meanwhile.
		const hold = setInterval(() => {}, 60_000)
		const creds = await login
			.startDeviceLogin(channel, {
				hasUI: process.stdin.isTTY === true,
				showCode: (url, code) => console.log(`Open ${url}\nand check the code is ${code}.`),
				pickOrg,
			})
			.finally(() => clearInterval(hold))
		if (!creds) return console.log('Login cancelled.')
		console.log(`Signed in to HumanLayer (${channel}) as ${creds.email}, org ${creds.orgName}.`)
		return
	}
	if (command === 'logout') {
		await login.logout(channel)
		console.log(`Signed out of HumanLayer (${channel}).`)
		return
	}
	if (command === 'status') {
		const who = await client.identity(channel)
		if (!who) return console.log(`Not signed in to HumanLayer (${channel}).`)
		if (who.source === 'pat') return console.log(`Using HUMANLAYER_PAT (${channel}).`)
		console.log(`Signed in to HumanLayer (${channel}) as ${who.email}, org ${who.orgName}.`)
		return
	}
	throw new Error(`unknown command "${command}": use login, logout or status`)
}

main().catch((err) => {
	console.error(`humanlayer-opencode: ${errorMessage(err)}`)
	process.exit(1)
})
