const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const contractDir = path.resolve(__dirname, '..');
const runnerDir = path.join(contractDir, 'test-contract-runner');
const upstreamDir = path.resolve(contractDir, '..');
const whitespacePattern = /\s/;
const tempRoot = path.join(
  process.env.IDENA_CLEAN_FORK_TMP || '/tmp',
  `idena-clean-fork-${process.getuid?.() || 'user'}`,
  'contract-runner-work'
);
const runnerBuildDir = whitespacePattern.test(upstreamDir)
  ? path.join(tempRoot, 'runner-build')
  : path.join(contractDir, 'build', 'test-contract-runner');
const runnerBinaryName =
  process.platform === 'win32' ? 'idena-contract-runner.exe' : 'idena-contract-runner';
const runnerBinary = path.join(runnerBuildDir, runnerBinaryName);
const runnerLogPath = path.join(runnerBuildDir, 'runner.log');
const runnerUrl = process.env.IDENA_CONTRACT_RUNNER_URL || 'http://127.0.0.1:3333';
const parsedRunnerUrl = new URL(runnerUrl);
const runnerHost = parsedRunnerUrl.hostname || 'localhost';
const runnerPort = parsedRunnerUrl.port || (parsedRunnerUrl.protocol === 'https:' ? '443' : '80');
const defaultToolchain = process.env.IDENA_CONTRACT_RUNNER_GOTOOLCHAIN || 'go1.26.5';

function copyFilteredDir(source, destination) {
  fs.rmSync(destination, { force: true, recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (sourcePath) => {
      const name = path.basename(sourcePath);
      return !['.git', 'node_modules', 'build', 'dist', 'target'].includes(name);
    },
  });
}

function runnerCwd() {
  if (!whitespacePattern.test(upstreamDir)) {
    return runnerDir;
  }

  const tempUpstream = path.join(tempRoot, 'upstream');

  fs.mkdirSync(tempUpstream, { recursive: true });

  copyFilteredDir(path.join(upstreamDir, 'idena-go'), path.join(tempUpstream, 'idena-go'));
  copyFilteredDir(path.join(upstreamDir, 'idena-wasm-binding'), path.join(tempUpstream, 'idena-wasm-binding'));
  copyFilteredDir(runnerDir, path.join(tempUpstream, path.basename(contractDir), 'test-contract-runner'));

  return path.join(tempUpstream, path.basename(contractDir), 'test-contract-runner');
}

function runnerEnv() {
  const env = {
    ...process.env,
    IDENA_CONTRACT_RUNNER_HOST: runnerHost,
    IDENA_CONTRACT_RUNNER_PORT: runnerPort,
  };

  if (defaultToolchain && (!env.GOTOOLCHAIN || env.GOTOOLCHAIN === 'auto')) {
    env.GOTOOLCHAIN = defaultToolchain;
  }

  return env;
}

async function rpcCall(method, params = []) {
  const response = await fetch(runnerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.error) {
    throw new Error(payload.error.message || 'Unknown RPC error');
  }

  return payload.result;
}

async function isRunnerAvailable() {
  try {
    await rpcCall('chain_god');
    return true;
  } catch {
    return false;
  }
}

function ensureRunnerSources() {
  const buildCwd = runnerCwd();
  const requiredPaths = [
    buildCwd,
    path.resolve(buildCwd, '..', '..', 'idena-go', 'go.mod'),
    path.resolve(buildCwd, '..', '..', 'idena-wasm-binding', 'lib'),
  ];

  const missing = requiredPaths.filter((target) => !fs.existsSync(target));

  if (missing.length > 0) {
    throw new Error(
      `Bundled contract runner dependencies are missing: ${missing.join(', ')}`
    );
  }
}

function buildRunner() {
  ensureRunnerSources();
  fs.mkdirSync(runnerBuildDir, { recursive: true });

  const result = spawnSync('go', ['build', '-tags=idena_memory_ipfs', '-o', runnerBinary, '.'], {
    cwd: runnerCwd(),
    env: runnerEnv(),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error('Failed to build the local idena-go v1.1.2 contract runner');
  }
}

function startRunner() {
  fs.mkdirSync(runnerBuildDir, { recursive: true });
  const logFd = fs.openSync(runnerLogPath, 'w');
  const child = spawn(runnerBinary, {
    cwd: runnerDir,
    env: runnerEnv(),
    stdio: ['ignore', logFd, logFd],
  });

  return { child, logFd };
}

async function waitForRunner(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      break;
    }

    if (await isRunnerAvailable()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  let logs = '';
  if (fs.existsSync(runnerLogPath)) {
    logs = fs.readFileSync(runnerLogPath, 'utf8').trim();
  }

  throw new Error(
    `Local contract runner did not become ready at ${runnerUrl}.${logs ? `\n\nRunner logs:\n${logs}` : ''}`
  );
}

function stopRunner(state) {
  if (!state) {
    return;
  }

  state.child.kill('SIGTERM');
  if (typeof state.logFd === 'number') {
    fs.closeSync(state.logFd);
  }
}

function runJest() {
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand'], {
    cwd: contractDir,
    env: {
      ...process.env,
      IDENA_CONTRACT_RUNNER_URL: runnerUrl,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

async function main() {
  let state = null;

  try {
    if (!(await isRunnerAvailable())) {
      buildRunner();
      state = startRunner();
      await waitForRunner(state.child);
    }

    process.exitCode = runJest();
  } finally {
    stopRunner(state);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
