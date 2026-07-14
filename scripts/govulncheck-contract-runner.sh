#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOCACHE="${GOCACHE:-${ROOT_DIR}/.cache/go-build}"
mkdir -p "${GOCACHE}"

(
  cd "${ROOT_DIR}/test-contract-runner"

  if go list -tags=idena_memory_ipfs -deps ./... | grep -Eq '^golang.org/x/crypto/openpgp($|/)'; then
    echo "govulncheck: forbidden OpenPGP package entered the contract runner dependency graph" >&2
    exit 1
  fi

  go tool govulncheck -format=json -tags=idena_memory_ipfs ./... |
    go run ../../idena-go/scripts/govulncheck_filter.go \
      -allow-reachable GO-2024-3218@github.com/libp2p/go-libp2p-kad-dht \
      -ignore-unreachable GO-2026-5932@golang.org/x/crypto
)
