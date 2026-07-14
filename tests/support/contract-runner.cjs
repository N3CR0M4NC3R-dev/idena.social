const ContractArgumentFormat = Object.freeze({
    Default: 'default',
    Byte: 'byte',
    Int8: 'int8',
    Uint64: 'uint64',
    Int64: 'int64',
    String: 'string',
    Bigint: 'bigint',
    Hex: 'hex',
    Dna: 'dna',
});

function toHexString(value) {
    return `0x${Buffer.from(value).toString('hex')}`;
}

class JsonRpcClient {
    constructor(url, apiKey) {
        this.url = url;
        this.apiKey = apiKey;
    }

    async doRequest(request) {
        const payload = {
            id: request.id || 1,
            method: request.method,
            params: request.params,
            key: this.apiKey,
        };

        const response = await fetch(this.url, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`JSON-RPC request failed with HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message || String(data.error));
        }
        return data.result;
    }
}

class ChainProvider {
    constructor(client) {
        this.client = client;
    }

    async generateBlocks(count) {
        return this.client.doRequest({
            method: 'chain_generateBlocks',
            params: [count],
        });
    }

    async receipt(hash) {
        return this.client.doRequest({
            method: 'chain_txReceipt',
            params: [hash],
        });
    }

    async godAddress() {
        return this.client.doRequest({
            method: 'chain_god',
            params: null,
        });
    }

    async resetTo(block) {
        return this.client.doRequest({
            method: 'chain_resetTo',
            params: [block],
        });
    }
}

class ContractProvider {
    constructor(client) {
        this.client = client;
    }

    async deploy(amount, maxFee, code, nonce, args = null) {
        return this.client.doRequest({
            method: 'contract_deploy',
            params: [
                {
                    code: toHexString(code),
                    nonce: toHexString(nonce),
                    amount,
                    args,
                    maxFee,
                },
            ],
        });
    }

    async call(contract, method, amount, maxFee, args = null) {
        return this.client.doRequest({
            method: 'contract_call',
            params: [
                {
                    contract,
                    method,
                    amount,
                    maxFee,
                    args,
                },
            ],
        });
    }

    async readData(contract, key, format) {
        return this.client.doRequest({
            method: 'contract_readData',
            params: [contract, key, format],
        });
    }

    async readMap(contract, map, key, format) {
        return this.client.doRequest({
            method: 'contract_readMap',
            params: [contract, map, key, format],
        });
    }
}

class ContractRunnerProvider {
    constructor(client) {
        this.Chain = new ChainProvider(client);
        this.Contract = new ContractProvider(client);
    }

    static create(url, apiKey) {
        return new ContractRunnerProvider(new JsonRpcClient(url, apiKey));
    }
}

module.exports = {
    ContractArgumentFormat,
    ContractRunnerProvider,
    toHexString,
};
