#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join(ROOT, 'compatibility', 'stack-lock.json')
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'build.yml')
const GO_MOD_PATH = path.join(ROOT, 'test-contract-runner', 'go.mod')
const GOLDEN_PATH = path.join(ROOT, 'compatibility', 'contract-release.sha256')
const RELEASE_WASM = path.join(ROOT, 'build', 'release.wasm')
const SHA1_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function readRegular(filePath, encoding = 'utf8') {
  const metadata = fs.lstatSync(filePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path.basename(filePath)} must be a regular file`)
  }
  return fs.readFileSync(filePath, encoding)
}

function verifySourcePins(lock, workflow, goMod, packageJson) {
  if (
    lock.schema !== 1 ||
    lock.status !== 'candidate' ||
    lock.chainInvariants?.consensusChangesAllowed !== false
  ) {
    throw new Error('Unexpected compatibility lock identity')
  }
  const expected = lock.consumerPins?.['idena-social-contract-runner']
  const components = new Map(
    (lock.components || []).map((component) => [component.name, component.commit])
  )
  if (!expected || Object.keys(expected).length !== 2) {
    throw new Error('Compatibility lock is missing contract-runner pins')
  }
  for (const [name, commit] of Object.entries(expected)) {
    if (!SHA1_PATTERN.test(commit) || components.get(name) !== commit) {
      throw new Error(`${name} has an invalid compatibility pin`)
    }
  }

  const fetched = [...workflow.matchAll(/fetch --depth 1 origin ([0-9a-f]{40})/g)].map(
    (match) => match[1]
  )
  const expectedFetched = [expected['idena-go'], expected['idena-wasm-binding']]
  if (
    fetched.length !== expectedFetched.length ||
    !expectedFetched.every((commit) => fetched.includes(commit))
  ) {
    throw new Error('Contract workflow source pins drifted from the compatibility lock')
  }
  if (!goMod.includes(`-${expected['idena-wasm-binding'].slice(0, 12)}`)) {
    throw new Error('Contract runner module does not require the locked binding')
  }
  if (packageJson.devDependencies?.assemblyscript !== '0.19.23') {
    throw new Error('AssemblyScript compiler must remain exactly pinned to 0.19.23')
  }
}

function verifyContractArtifact() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const build = spawnSync(npm, ['run', 'asbuild:release'], {
    cwd: ROOT,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status || 1)

  const golden = readRegular(GOLDEN_PATH).trim().split(/\s+/)
  if (golden.length !== 2 || !SHA256_PATTERN.test(golden[0]) || golden[1] !== 'release.wasm') {
    throw new Error('Invalid contract release checksum manifest')
  }
  const actual = crypto
    .createHash('sha256')
    .update(readRegular(RELEASE_WASM, null))
    .digest('hex')
  if (actual !== golden[0]) {
    throw new Error('Compiled contract differs from the reviewed release Wasm')
  }
}

function main() {
  verifySourcePins(
    JSON.parse(readRegular(LOCK_PATH)),
    readRegular(WORKFLOW_PATH),
    readRegular(GO_MOD_PATH),
    JSON.parse(readRegular(path.join(ROOT, 'package.json')))
  )
  verifyContractArtifact()
  console.log('Contract compatibility lock passed')
}

if (require.main === module) main()

module.exports = {verifySourcePins}
