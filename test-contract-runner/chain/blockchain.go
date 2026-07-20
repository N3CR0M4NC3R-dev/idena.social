package chain

import (
	"crypto/ecdsa"
	"github.com/idena-network/idena-go/blockchain"
	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/blockchain/validation"
	"github.com/idena-network/idena-go/common"
	"github.com/idena-network/idena-go/common/eventbus"
	"github.com/idena-network/idena-go/config"
	"github.com/idena-network/idena-go/core/appstate"
	"github.com/idena-network/idena-go/core/mempool"
	"github.com/idena-network/idena-go/core/state"
	"github.com/idena-network/idena-go/core/upgrade"
	"github.com/idena-network/idena-go/crypto"
	"github.com/idena-network/idena-go/ipfs"
	"github.com/idena-network/idena-go/keystore"
	"github.com/idena-network/idena-go/secstore"
	"github.com/idena-network/idena-go/stats/collector"
	"github.com/idena-network/idena-go/subscriptions"
	"github.com/shopspring/decimal"
	db "github.com/tendermint/tm-db"
	"log"
	"math/big"
	"os"
	"time"
)

type MemBlockchain struct {
	*blockchain.Blockchain
	txpool   *mempool.TxPool
	appstate *appstate.AppState
	keyStore *keystore.KeyStore
	secStore *secstore.SecStore

	setDataMiddlewareValues map[common.Address]map[string][]byte
}

func NewMemBlockchain(godKey *ecdsa.PrivateKey) *MemBlockchain {
	db := db.NewMemDB()
	bus := eventbus.New()
	appState, _ := appstate.NewAppState(db, bus)
	secStore := secstore.NewSecStore()
	secStore.AddKey(crypto.FromECDSA(godKey))

	addr := crypto.PubkeyToAddress(godKey.PublicKey)

	consensusCfg := *config.ConsensusVersions[config.ConsensusV12]
	consensusCfg.Automine = true
	cfg := &config.Config{
		Network:   0x99,
		Consensus: &consensusCfg,
		GenesisConf: &config.GenesisConf{
			Alloc: map[common.Address]config.GenesisAllocation{
				addr: {Balance: big.NewInt(0).Mul(big.NewInt(1000000), common.DnaBase)},
			},
			GodAddress:        addr,
			FirstCeremonyTime: 4070908800, //01.01.2099
		},
		Validation: &config.ValidationConfig{},
		Blockchain: &config.BlockchainConfig{
			WriteAllEvents: true,
		},
		IsDebug: true,
	}

	if cfg.OfflineDetection == nil {
		cfg.OfflineDetection = config.GetDefaultOfflineDetectionConfig()
	}
	if cfg.Mempool == nil {
		cfg.Mempool = config.GetDefaultMempoolConfig()
	}
	validation.SetAppConfig(cfg)

	txPool := mempool.NewTxPool(appState, bus, cfg, collector.NewStatsCollector())
	offline := blockchain.NewOfflineDetector(cfg, db, appState, secStore, bus)

	keystoreDir, err := os.MkdirTemp("", "keystore")
	if err != nil {
		log.Fatal(err)
	}

	subscriptionsDir, err := os.MkdirTemp("", "subscriptions")
	if err != nil {
		log.Fatal(err)
	}

	keyStore := keystore.NewKeyStore(keystoreDir, keystore.StandardScryptN, keystore.StandardScryptP)
	subManager, _ := subscriptions.NewManager(subscriptionsDir)
	upgrader := upgrade.NewUpgrader(cfg, appState, db)
	chain := blockchain.NewBlockchain(cfg, db, txPool, appState, ipfs.NewMemoryIpfsProxy(), secStore, bus, offline, keyStore, subManager, upgrader)
	chain.InitializeChain()
	appState.Initialize(chain.Head.Height())

	result := &MemBlockchain{chain, txPool, appState, keyStore, secStore, map[common.Address]map[string][]byte{}}
	txPool.Initialize(chain.Head, secStore.GetAddress(), false)
	result.UseMiddleware(result.setDataMiddleware)
	return result
}

func (b *MemBlockchain) KeyStore() *keystore.KeyStore {
	return b.keyStore
}

func (b *MemBlockchain) SecStore() *secstore.SecStore {
	return b.secStore
}

func (b *MemBlockchain) AppStateForCheck() (*appstate.AppState, error) {
	return b.appstate.ForCheck(0)
}
func (b *MemBlockchain) ReadonlyAppState() (*appstate.AppState, error) {
	return b.appstate.Readonly(0)
}

func (b *MemBlockchain) TxPool() *mempool.TxPool {
	return b.txpool
}

func (b *MemBlockchain) GenerateBlocks(count int) {
	for i := 0; i < count; i++ {
		now := time.Now().UTC().Unix()
		if b.Head != nil && now-b.Head.Time() > int64(time.Minute/time.Second) {
			switch {
			case b.Head.ProposedHeader != nil:
				b.Head.ProposedHeader.Time = now
			case b.Head.EmptyBlockHeader != nil:
				b.Head.EmptyBlockHeader.Time = now
			}
		}

		block := b.ProposeBlock([]byte{})
		block.Block.Header.ProposedHeader.Time = b.Head.Time() + 20
		if now > block.Block.Header.ProposedHeader.Time {
			block.Block.Header.ProposedHeader.Time = now
		}
		err := b.AddBlock(block.Block, nil, collector.NewStatsCollector())
		if err != nil {
			panic(err)
		}
		b.addCert(block.Block)
	}
}

func (b *MemBlockchain) addCert(block *types.Block) {
	vote := &types.Vote{
		Header: &types.VoteHeader{
			Round:       block.Height(),
			Step:        1,
			ParentHash:  block.Header.ParentHash(),
			VotedHash:   block.Header.Hash(),
			TurnOffline: false,
		},
	}
	hash := crypto.SignatureHash(vote)
	vote.Signature = b.secStore.Sign(hash[:])
	cert := types.FullBlockCert{Votes: []*types.Vote{vote}}
	b.WriteCertificate(block.Header.Hash(), cert.Compress(), true)
}

func (b *MemBlockchain) SetIdentity(addr common.Address, status state.IdentityState) {
	b.appstate.State.SetState(addr, status)
}

func (b *MemBlockchain) AddBalance(addr common.Address, amount decimal.Decimal) {
	b.appstate.State.AddBalance(addr, blockchain.ConvertToInt(amount))
}

func (b *MemBlockchain) SetContractData(addr common.Address, key string, data []byte) {
	var m map[string][]byte
	var ok bool
	if m, ok = b.setDataMiddlewareValues[addr]; !ok {
		m = map[string][]byte{}
		b.setDataMiddlewareValues[addr] = m
	}
	m[key] = data
}

func (b *MemBlockchain) setDataMiddleware(block *types.Block, appState *appstate.AppState) {
	for contract, m := range b.setDataMiddlewareValues {
		for key, value := range m {
			appState.State.SetContractValue(contract, []byte(key), value)
		}
	}
}

func (b *MemBlockchain) CleanDataMiddlewareValues() {
	b.setDataMiddlewareValues = map[common.Address]map[string][]byte{}
}
