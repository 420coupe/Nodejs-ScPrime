/* eslint-disable no-unused-expressions */
import 'babel-polyfill'
import BigNumber from 'bignumber.js'
import Path from 'path'
import { agent, scpToHastings, call, hastingsToSCP, isRunning, connect, errCouldNotConnect } from '../src/scprime.js'
import http from 'http'
import readdir from 'readdir'
import { expect } from 'chai'
import proxyquire from 'proxyquire'
import { spy, stub } from 'sinon'
import nock from 'nock'
import fs from 'fs'

// Mock the process calls required for testing spd launch functionality.
const mockProcessObject = {
	stdout: {
		pipe: spy(),
	},
	stderr: {
		pipe: spy(),
	},
}
const mock = {
	'child_process': {
		spawn: stub().returns(mockProcessObject),
	},
}
const { launch, makeRequest } = proxyquire('../src/scprime.js', mock)

BigNumber.config({DECIMAL_PLACES: 28})

const hastingsPerSCP = new BigNumber('1000000000000000000000000000')

describe('scprime.js wrapper library', () => {
	describe('unit conversion functions', () => {
		it('converts from SCP to hastings correctly', () => {
			const maxSCP = new BigNumber('100000000000000000000000000')
			for (let i = 0; i < 999; i++) {
				const scp = maxSCP.times(Math.trunc(Math.random() * 100000) / 100000)
				const expectedHastings = scp.times(hastingsPerSCP)
				expect(scpToHastings(scp).toString()).to.equal(expectedHastings.toString())
			}
		})
		it('converts from hastings to SCP correctly', () => {
			const maxH = new BigNumber('10').toPower(150)
			for (let i = 0; i < 999; i++) {
				const h = maxH.times(Math.trunc(Math.random() * 100000) / 100000)
				const expectedSCP = h.dividedBy(hastingsPerSCP)
				expect(hastingsToSCP(h).toString()).to.equal(expectedSCP.toString())
			}
		})
		it('does not lose precision during unit conversions', () => {
			// convert from base unit -> SCP n_iter times, comparing the (n_iter-times) converted value at the end.
			// if precision loss were occuring, the original and the converted value would differ.
			const n_iter = 10000
			const originalSCP = new BigNumber('1337338498282837188273')
			let convertedSCP = originalSCP
			for (let i = 0; i < n_iter; i++) {
				convertedSCP = hastingsToSCP(scpToHastings(convertedSCP))
			}
			expect(convertedSCP.toString()).to.equal(originalSCP.toString())
		})
	})
	describe('spd interaction functions', () => {
		describe('isRunning', () => {
			it('returns true when spd is running', async() => {
				nock('http://localhost:4280')
				  .get('/gateway')
				  .reply(200, 'success')
				const running = await isRunning('localhost:4280')
				expect(running).to.be.true
			})
			it('returns false when spd is not running', async() => {
				nock('http://localhost:4280')
				  .get('/gateway')
				  .replyWithError('error')
				const running = await isRunning('localhost:4280')
				expect(running).to.be.false
			})
		})
		describe('connect', () => {
			it('throws an error if spd is unreachable', async() => {
				nock('http://localhost:4280')
				  .get('/gateway')
				  .replyWithError('test-error')
				let didThrow = false
				let err
				try {
					await connect('localhost:4280')
				} catch (e) {
					didThrow = true
					err = e
				}
				expect(didThrow).to.be.true
				expect(err).to.equal(errCouldNotConnect)
			})

			let spd
			it('returns a valid spd object if scprime is reachable', async() => {
				nock('http://localhost:4280')
				  .get('/gateway')
				  .reply(200, 'success')
				spd = await connect('localhost:4280')
				expect(spd).to.have.property('call')
				expect(spd).to.have.property('isRunning')
			})
			it('can make api calls using spd.call', async() => {
				nock('http://localhost:4280')
				  .get('/gateway')
				  .reply(200, 'success')

				const gateway = await spd.call('/gateway')
				expect(gateway).to.equal('success')
			})
		})
		describe('makeRequest', () => {
			it('constructs the correct request options given a string parameter', () => {
				const expectedOpts = {
					url: 'http://localhost:4280/test',
					json: true,
					timeout: 10000,
					headers: {
						'User-Agent': 'ScPrime-Agent',
					},
				}
				expect(makeRequest('localhost:4280', '/test')).to.contain.keys(expectedOpts)
			})
			it('constructs the correct request options given an object parameter', () => {
				const testparams = {
					test: 'test',
				}
				const expectedOpts = {
					url: 'http://localhost:4280/test',
					qs: testparams,
					headers: {
						'User-Agent': 'ScPrime-Agent',
					},
					timeout: 10000,
					json: true,
				}
				expect(makeRequest('localhost:4280', { url: '/test', qs: testparams })).to.contain.keys(expectedOpts)
			})
		})
		describe('launch', () => {
			afterEach(() => {
				mock['child_process'].spawn = stub().returns(mockProcessObject)
				mockProcessObject.stdout.pipe.reset()
				mockProcessObject.stderr.pipe.reset()
			})
			it('starts spd with sane defaults if no flags are passed', () => {
				const expectedFlags = [
					'--api-addr=localhost:4280',
					'--host-addr=:4282',
					'--rpc-addr=:4281',
				]
				launch('testpath')
				expect(mock['child_process'].spawn.called).to.be.true
				expect(mock['child_process'].spawn.getCall(0).args[1]).to.deep.equal(expectedFlags)
			})
			it('starts spd with --scp-directory given scp-directory', () => {
				const testSettings = {
					'scp-directory': 'testdir',
				}
				try {
					fs.mkdirSync('./testdir')
				} catch (e) {
					if (e.code !== 'EEXIST') {
						throw e
					}
				}
				launch('testpath', testSettings)
				expect(mock['child_process'].spawn.called).to.be.true
				const flags = mock['child_process'].spawn.getCall(0).args[1]
				const path = mock['child_process'].spawn.getCall(0).args[0]
				expect(flags).to.contain('--scp-directory=testdir')
				expect(path).to.equal('testpath')
			})
			it('sets boolean flags correctly', () => {
				launch('testpath', {'testflag': true})
				const flags = mock['child_process'].spawn.getCall(0).args[1]
				expect(flags.indexOf('--testflag=true') !== -1).to.be.true
				expect(flags.indexOf('--testflag=false') !== -1).to.be.false
			})
			it('starts spdd with the same pid as the calling process', () => {
				launch('testpath')
				if (process.geteuid) {
					expect(mock['child_process'].spawn.getCall(0).args[2].uid).to.equal(process.geteuid())
				}
			})
			it('pipes output to file correctly given no scp-dir', () => {
				launch('testpath')
				expect(mockProcessObject.stdout.pipe.calledWith(fs.createWriteStream('spd-output.log')))
			})
			it('pipes output to file correctly given a scp-dir', () => {
				launch('testpath', { 'scp-directory': 'testdir' })
				expect(mockProcessObject.stdout.pipe.calledWith(fs.createWriteStream(Path.join('testdir', 'spd-output.log'))))
			})
		})
		describe('call', () => {
			it('should not leak file descriptors making heavy requests to unresponsive endpoints', (done) => {
				const ndescriptors = () => readdir.readSync('/proc/'+process.pid+'/fd').length
				// create a http server that returns from requests very slowly
				const testsrv = http.createServer((req, res) => {
					setTimeout(() => {
						res.writeHead(200)
						res.end()
					}, 20000)
				})
				testsrv.listen(31243, '127.0.0.1', () => {
					// record the initial FD count
					const initialDescriptors = ndescriptors()
					// make lots of calls
					for (let i = 0; i < 400; i++) {
						call('localhost:31243', '/test')
					}
					// wait a bit for all the calls to be received
					setTimeout(() => {
						// after calling, additional file descriptor count should not
						// exceed agent.maxSockets * 2 (one FD for the server, one for the
						// client)
						const descriptorDelta = ndescriptors() - initialDescriptors
						expect(descriptorDelta).to.be.most(agent.maxSockets*2)
						testsrv.close()
						done()
					}, 2000)
				})
			}).timeout(20000)
		})
	})
})

/* eslint-enable no-unused-expressions */
