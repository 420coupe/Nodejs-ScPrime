// scprime.js: a lightweight node wrapper for starting, and communicating with
// a SCP daemon (spd).
import BigNumber from 'bignumber.js'
import fs from 'fs'
import { spawn } from 'child_process'
import Path from 'path'
import request from 'request'
import http from 'http'

const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 20,
})

// scprime.js error constants
export const errCouldNotConnect = new Error('could not connect to the SCP daemon')

// SCP -> hastings unit conversion functions
// These make conversion between units of SCP easy and consistent for developers.
// Never return exponentials from BigNumber.toString, since they confuse the API
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })
BigNumber.config({ DECIMAL_PLACES: 30 })

const hastingsPerSiacoin = new BigNumber('10').toPower(24)
const siacoinsToHastings = (siacoins) => new BigNumber(siacoins).times(hastingsPerSiacoin)
const hastingsToSiacoins = (hastings) => new BigNumber(hastings).dividedBy(hastingsPerSiacoin)

const hastingsPerSCP = new BigNumber('10').toPower(27)
const scpToHastings = (scp) => new BigNumber(scp).times(hastingsPerSCP)
const hastingsToSCP = (hastings) => new BigNumber(hastings).dividedBy(hastingsPerSCP)

// makeRequest takes an address and opts and returns a valid request.js request
// options object.
export const makeRequest = (address, opts) => {
	let callOptions = opts
	if (typeof opts === 'string') {
		callOptions = { url: opts }
	}
	callOptions.url = 'http://' + address + callOptions.url
	callOptions.json = true
	if (typeof callOptions.timeout === 'undefined') {
		callOptions.timeout = 10000
	}
	callOptions.headers = {
		'User-Agent': 'ScPrime-Agent',
	}
	callOptions.pool = agent

	return callOptions
}

// Call makes a call to the SCP API at `address`, with the request options defined by `opts`.
// returns a promise which resolves with the response if the request completes successfully
// and rejects with the error if the request fails.
const call = (address, opts) => new Promise((resolve, reject) => {
	const callOptions = makeRequest(address, opts)
	request(callOptions, (err, res, body) => {
		if (!err && (res.statusCode < 200 || res.statusCode > 299)) {
			reject(body)
		} else if (!err) {
			resolve(body)
		} else {
			reject(err)
		}
	})
})

// launch launches a new instance of spd using the flags defined by `settings`.
// this function can `throw`, callers should catch errors.
// callers should also handle the lifecycle of the spawned process.
const launch = (path, settings) => {
	const defaultSettings = {
		'api-addr': 'localhost:4280',
		'host-addr': ':4282',
		'rpc-addr': ':4281',
		'authenticate-api': false,
		'disable-api-security': false,
	}
	const mergedSettings = Object.assign(defaultSettings, settings)
	const filterFlags = (key) => mergedSettings[key] !== false
	const mapFlags = (key) => '--' + key + '=' + mergedSettings[key]
	const flags = Object.keys(mergedSettings).filter(filterFlags).map(mapFlags)

	const spdOutput = (() => {
		if (typeof mergedSettings['scp-directory'] !== 'undefined') {
			return fs.createWriteStream(Path.join(mergedSettings['scp-directory'], 'spd-output.log'))
		}
		return fs.createWriteStream('spd-output.log')
	})()

	const opts = { }
	if (process.geteuid) {
		opts.uid = process.geteuid()
	}
	const spdProcess = spawn(path, flags, opts)
	spdProcess.stdout.pipe(spdOutput)
	spdProcess.stderr.pipe(spdOutput)
	return spdProcess
}

// isRunning returns true if a successful call can be to /gateway
// using the address provided in `address`.  Note that this call does not check
// whether the spd process is still running, it only checks if a SCP API is
// reachable.
async function isRunning(address) {
	try {
		await call(address, {
			url: '/gateway',
			timeout: 6e5, // 10 minutes
		})
		return true
	} catch (e) {
		return false
	}
}

// spdWrapper returns an instance of a spd API configured with address.
const spdWrapper = (address) => {
	const spdAddress = address
	return {
		call: (options)  => call(spdAddress, options),
		isRunning: () => isRunning(spdAddress),
	}
}

// connect connects to a running spd at `address` and returns a spdWrapper object.
async function connect(address) {
	const running = await isRunning(address)
	if (!running) {
		throw errCouldNotConnect
	}
	return spdWrapper(address)
}

export {
	connect,
	launch,
	isRunning,
	call,
	siacoinsToHastings,
	hastingsToSiacoins,
	scpToHastings,
	hastingsToSCP,
	agent,
}
