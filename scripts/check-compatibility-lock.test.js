const lock = require('../compatibility/stack-lock.json')
const pkg = require('../package.json')
const fs = require('fs')
const path = require('path')
const {verifySourcePins} = require('./check-compatibility-lock.cjs')

const root = path.resolve(__dirname, '..')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8')
const goMod = fs.readFileSync(path.join(root, 'test-contract-runner/go.mod'), 'utf8')

describe('contract compatibility lock', () => {
  it('pins the reviewed node, binding, and compiler', () => {
    expect(() => verifySourcePins(lock, workflow, goMod, pkg)).not.toThrow()
  })

  it('rejects a different node source', () => {
    const changed = workflow.replace(
      lock.consumerPins['idena-social-contract-runner']['idena-go'],
      '0'.repeat(40)
    )
    expect(() => verifySourcePins(lock, changed, goMod, pkg)).toThrow(
      'Contract workflow source pins drifted from the compatibility lock'
    )
  })

  it('rejects an AssemblyScript compiler range', () => {
    const changed = JSON.parse(JSON.stringify(pkg))
    changed.devDependencies.assemblyscript = '^0.19.23'
    expect(() => verifySourcePins(lock, workflow, goMod, changed)).toThrow(
      'AssemblyScript compiler must remain exactly pinned to 0.19.23'
    )
  })
})
