package chain

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/idena-network/idena-go/blockchain"
	"github.com/idena-network/idena-go/blockchain/attachments"
	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/common"
	"github.com/idena-network/idena-go/crypto"
	"github.com/shopspring/decimal"
)

func TestMemBlockchainStoresReceiptForWasmDeploy(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}

	chain := NewMemBlockchain(key)
	chain.GenerateBlocks(1)

	wasm, err := os.ReadFile(filepath.Join("..", "..", "build", "release.wasm"))
	if err != nil {
		t.Fatal(err)
	}

	attachment, err := attachments.CreateDeployContractAttachment(common.Hash{}, wasm, nil).ToBytes()
	if err != nil {
		t.Fatal(err)
	}

	tx := blockchain.BuildTxWithFeeEstimating(chain.appstate, chain.secStore.GetAddress(), nil, types.DeployContractTx, decimal.Zero, decimal.RequireFromString("9999"), decimal.Zero, 0, 0, attachment)
	tx, err = chain.secStore.SignTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	if err := chain.txpool.AddInternalTx(tx); err != nil {
		t.Fatal(err)
	}
	chain.GenerateBlocks(1)

	idx := chain.GetTxIndex(tx.Hash())
	if idx == nil {
		t.Fatal("expected tx index")
	}

	receipt := chain.GetReceipt(tx.Hash())
	if receipt == nil {
		t.Fatal("expected tx receipt")
	}
}
