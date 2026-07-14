# idena.social

AssemblyScript source and tests for the idena.social smart contract.

[![Build and test](https://github.com/ubiubi18/idena.social/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/ubiubi18/idena.social/actions/workflows/build.yml)

The upstream project links the live contract at
[`0x840e092e31e9656fF15E541505039ed77585338E`](https://scan.idena.io/contract/0x840e092e31e9656fF15E541505039ed77585338E).
That link identifies an on-chain deployment; it does not prove that the deployed
bytecode was built from this fork's current `HEAD`. Verify deployment source,
bytecode, network, and contract state independently before interacting with it.

> This fork has no published package or contract release and does not deploy or
> upgrade the live contract automatically.

## What was updated

- Development and CI now use Node `24.18.0`, npm `11.16.0`, Go `1.26.5`, and a
  reproducible npm lockfile.
- The obsolete external contract SDK chain was removed from production
  dependencies. Only the minimal AssemblyScript test surface required to build
  the contract is vendored locally.
- A local Go JSON-RPC contract runner exercises the compiled Wasm against exact
  sibling `idena-go` and `idena-wasm-binding` sources with memory-only IPFS.
- [`compatibility/stack-lock.json`](compatibility/stack-lock.json) binds those
  sources to the reviewed legacy-compatible runtime, while the release Wasm
  must reproduce the committed SHA-256 digest.
- Contract-runner dependencies, node and binding revisions, CI actions, and
  audit tooling are pinned and reviewed together.
- CI runs npm dependency/signature audits, a privacy scan, Go vulnerability
  policy, AssemblyScript compilation, and end-to-end contract tests.

## Benefits

- The contract SDK no longer expands the production dependency graph.
- Tests run against the maintained node/Wasm execution path instead of a stale
  JavaScript simulation alone.
- Memory-only IPFS keeps test runs isolated from a developer's real node data
  and avoids installing or starting a persistent IPFS daemon.
- Locked dependencies and source pins make CI failures and contract fixtures
  easier to reproduce.

## Risks and tradeoffs

- Smart-contract changes are irreversible after deployment unless the contract
  explicitly supports an upgrade path. A passing local test is not permission
  to deploy against valuable state.
- The local runner is a test harness. Memory IPFS, synthetic chain state, and
  deterministic fixtures do not reproduce mainnet timing, load, peer behavior,
  fees, or all node configurations.
- The runner uses sibling source replacements. Testing against different
  `idena-go` or binding revisions creates results that CI did not validate.
- AssemblyScript `0.19.23` is retained for contract compatibility. Updating it
  can change generated Wasm and must be reviewed as a protocol-level change.
- `govulncheck` follows the node's documented exception policy; reviewed
  exceptions are not the same as having zero upstream risk.

## Build and test

Requirements:

- Node.js `24.18.0` and npm `11.16.0`
- Go `1.26.5` and a C compiler
- Matching sibling checkouts at `../idena-go` and `../idena-wasm-binding`

```bash
npm ci
npm run audit:privacy
npm run audit:contracts
npm test
```

`npm test` first builds the release Wasm, builds or reuses the local Go runner,
starts it on loopback, runs Jest serially, and shuts down the runner. Override
`IDENA_CONTRACT_RUNNER_URL` only for a deliberately managed test service.

Build the contract without running tests:

```bash
npm run asbuild:release
```

Inspect and record the resulting Wasm hash before comparing it with any deployed
contract.

## Upstream proposal

These changes are proposed in
[`N3CR0M4NC3R-dev/idena.social#1`](https://github.com/N3CR0M4NC3R-dev/idena.social/pull/1).
