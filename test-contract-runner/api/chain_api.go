package api

import (
	"fmt"
	"github.com/idena-network/idena-contract-runner/chain"
	"github.com/idena-network/idena-go/blockchain"
	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/common"
	"github.com/idena-network/idena-go/core/mempool"
	"github.com/idena-network/idena-go/core/state"
	"github.com/idena-network/idena-go/log"
	"github.com/shopspring/decimal"
	"math/big"
)

type ChainApi struct {
	baseApi *BaseApi
	pool    *mempool.TxPool
	bc      *chain.MemBlockchain
}

func NewChainApi(baseApi *BaseApi, chain *chain.MemBlockchain, pool *mempool.TxPool) *ChainApi {
	return &ChainApi{
		baseApi: baseApi,
		bc:      chain,
		pool:    pool,
	}
}

func (api *ChainApi) GenerateBlocks(cnt int) {
	fmt.Println(fmt.Sprintf("start generating blocks: %v", cnt))
	api.bc.GenerateBlocks(cnt)
	api.LogBalance()
}

func (api *ChainApi) TxReceipt(hash common.Hash) *TxReceipt {
	tx := api.pool.GetTx(hash)
	var idx *types.TransactionIndex

	if tx == nil {
		tx, idx = api.bc.GetTx(hash)
	}

	if tx == nil {
		return nil
	}

	if idx == nil {
		idx = api.bc.GetTxIndex(hash)
	}

	var blockHash common.Hash
	var feePerGas *big.Int
	if idx != nil {
		blockHash = idx.BlockHash
		block := api.bc.GetBlock(blockHash)
		if block != nil {
			feePerGas = block.Header.FeePerGas()
		}
	}

	receipt := api.bc.GetReceipt(hash)
	if receipt == nil {
		return nil
	}
	return convertReceipt(tx, receipt, feePerGas)
}

func (api *ChainApi) ResetTo(block uint64) error {
	_, err := api.bc.ResetTo(block)
	if err != nil {
		return err
	}
	log.Info("Chain was reset", "block", block)
	api.LogBalance()
	return nil
}

func (api *ChainApi) SetIdentity(addr common.Address, status state.IdentityState) {
	api.bc.SetIdentity(addr, status)
}

func (api *ChainApi) AddBalance(addr common.Address, amount decimal.Decimal) {
	api.bc.AddBalance(addr, amount)
}

func (api *ChainApi) GetBalance(addr common.Address) decimal.Decimal {
	state := api.baseApi.getAppStateForCheck()
	return blockchain.ConvertToFloat(state.State.GetBalance(addr))
}

func (api *ChainApi) SetContractData(addr common.Address, key string, value string, format string) error {
	arg := DynamicArg{Value: value, Format: format}
	data, err := arg.ToBytes()
	if err != nil {
		return err
	}
	api.bc.SetContractData(addr, key, data)
	api.bc.GenerateBlocks(1)
	api.bc.CleanDataMiddlewareValues()
	return nil
}

func (api *ChainApi) God() common.Address {
	return api.baseApi.getCurrentCoinbase()
}

func (api *ChainApi) LogBalance() {
	stateDb := api.baseApi.getAppStateForCheck()
	log.Info("Blockchain balances:")
	stateDb.State.IterateOverAccounts(func(addr common.Address, account state.Account) {
		log.Info("", "addr", addr.String(), "balance", blockchain.ConvertToFloat(account.Balance).String()+" IDNA")
	})
}
