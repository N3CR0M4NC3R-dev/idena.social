const path = require('path');
const fs = require('fs');

const {
    toHexString,
    ContractRunnerProvider,
    ContractArgumentFormat,
} = require('./support/contract-runner.cjs');

const CONTRACT_RUNNER_URL = process.env.IDENA_CONTRACT_RUNNER_URL || 'http://localhost:3333';

function str2hex(str) {
    return toHexString(Buffer.from(str));
}

function rmZeros(str) {
    return str.replaceAll(/[.0]+$/g, '');
}

const provider = ContractRunnerProvider.create(CONTRACT_RUNNER_URL, '');

function resolveBuiltWasm() {
    const candidates = [
        path.join('.', 'build', 'release.wasm'),
        path.join('.', 'build', 'release', 'idena.social.wasm'),
    ];

    const wasm = candidates.find((candidate) => fs.existsSync(candidate));

    if (!wasm) {
        throw new Error(`Compiled wasm not found. Looked in: ${candidates.join(', ')}`);
    }

    return wasm;
}

describe('idena.social.wasm', () => {
    let deployReceipt;
    let sender;

    beforeAll(async () => {
        try {
            await provider.Chain.godAddress();
        } catch (error) {
            throw new Error(
                `Contract runner at ${CONTRACT_RUNNER_URL} is unavailable. Start the local Idena contract runner before running this suite. ${error.message}`
            );
        }
    });

    beforeEach(async () => {
        const wasm = resolveBuiltWasm();

        const code = fs.readFileSync(wasm);

        await provider.Chain.generateBlocks(1);
        await provider.Chain.resetTo(2);

        const deployTx = await provider.Contract.deploy(
            '0',
            '9999',
            code,
            Buffer.from('')
        );
        await provider.Chain.generateBlocks(1);

        deployReceipt = await provider.Chain.receipt(deployTx);
    });

    describe('makePost', () => {
        it('should make a post', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'makePost',
                '0',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({
                            channelId: 'general',
                            message: 'test message',
                            replyToPostId: 'testReplyId',
                            repostPostId: 'testRepostId',
                            media: ['ipfs://000000000000000000000000000', 'ipfs://11111111111111111111111111'],
                            mediaType: ['image/jpeg', 'video/mp4'],
                            tags: ['0x12345', '0x54321', '0x00001']
                        }),
                    },
                ]
            );
            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(true);

            expect(receipt.events.length).toBe(2);
            expect(receipt.events[0].event).toBe('makePost');
            expect(receipt.events[0].args.length).toBe(10);
            expect(receipt.events[0].args[0].startsWith('0x')).toBe(true);
            expect(receipt.events[0].args[0].length).toBe(42);
            expect(parseInt(rmZeros(receipt.events[0].args[1]), 16)).toBe(1);
            expect(receipt.events[0].args[2]).toBe(str2hex('general'));
            expect(receipt.events[0].args[3]).toBe(str2hex('test message'));
            expect(receipt.events[0].args[4]).toBe(str2hex('testReplyId'));
            expect(receipt.events[0].args[5]).toBe(str2hex('testRepostId'));
            expect(receipt.events[0].args[6]).toBe(str2hex('ipfs://000000000000000000000000000,ipfs://11111111111111111111111111'));
            expect(receipt.events[0].args[7]).toBe(str2hex('image/jpeg,video/mp4'));
            expect(receipt.events[0].args[8]).toBe(str2hex('0x12345,0x54321,0x00001'));
            expect(parseInt(receipt.events[0].args[9], 16)).toBe(0);

            expect(receipt.events[1].event).toBe('_identity');
            expect(receipt.events[1].args.length).toBe(4);

            // Setting the sender for all tests.
            sender = receipt.events[0].args[0];
            // Do not delete

            const posterHex = await provider.Contract.readMap(
                deployReceipt.contract,
                'p:',
                receipt.events[0].args[1],
                'string',
            );
            expect(posterHex.startsWith('0x')).toBe(true);
            expect(posterHex.length).toBe(42);

            const stateResult = await provider.Contract.readData(
                deployReceipt.contract,
                'STATE',
                'string',
            );
            const state = JSON.parse(stateResult);
            expect(parseInt(state.currentPostId)).toBe(1);
        });
    });

    describe('sendTip', () => {
        beforeEach(async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'makePost',
                '0',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ channelId: 'general', message: 'test message' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);
            await provider.Chain.receipt(tx);
        });


        it('should send tip to post', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendTip',
                '10',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ postId: '1', tipAmount: '10' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(true);

            expect(receipt.events.length).toBe(2);
            expect(receipt.events[0].event).toBe('sendTip');
            expect(receipt.events[0].args.length).toBe(5);
            expect(receipt.events[0].args[0]).toBe(sender);
            expect(receipt.events[0].args[1]).toBe(sender);
            expect(parseInt(rmZeros(receipt.events[0].args[2]), 16)).toBe(1);
            expect(parseInt(receipt.events[0].args[3], 16)).toBe(10e18);
            expect(parseInt(receipt.events[0].args[4], 16)).toBe(10e18);

            expect(receipt.events[1].event).toBe('_identity');
            expect(receipt.events[1].args.length).toBe(4);
        });

        it('should send tip amount specified in args', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendTip',
                '10',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ postId: '1', tipAmount: '9' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(true);

            expect(parseInt(receipt.events[0].args[3], 16)).toBe(9e18);
            expect(parseInt(receipt.events[0].args[4], 16)).toBe(10e18);
        });

        it('should error when post does not exist', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendTip',
                '10',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ postId: '2', tipAmount: '10' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(false);
            expect(receipt.error.includes('non-existent post')).toBe(true);
        });

        it('should error when tip not sent', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendTip',
                '10',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ postId: '1', tipAmount: '0' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(false);
            expect(receipt.error.includes('cannot tip nothing')).toBe(true);
        });

        it('should error when tip amount more than sent', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendTip',
                '10',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ postId: '1', tipAmount: '11' }),
                    },
                ]
            );

            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(false);
            expect(receipt.error.includes('cannot tip more than sent')).toBe(true);
        });
    });

    describe('sendMessage', () => {
        it('should send message', async () => {
            const tx = await provider.Contract.call(
                deployReceipt.contract,
                'sendMessage',
                '0',
                '9999',
                [
                    {
                        index: 0,
                        format: ContractArgumentFormat.String,
                        value: JSON.stringify({ message: ['variant1', 'variant2'], messageHash: 'messageHash', encrypted: false }),
                    },
                ]
            );
            await provider.Chain.generateBlocks(1);

            const receipt = await provider.Chain.receipt(tx);
            expect(receipt.success).toBe(true);

            expect(receipt.events.length).toBe(2);
            expect(receipt.events[0].event).toBe('sendMessage');
            expect(receipt.events[0].args.length).toBe(6);
            expect(receipt.events[0].args[0]).toBe(sender);
            expect(parseInt(rmZeros(receipt.events[0].args[1]), 16)).toBe(1);
            expect(receipt.events[0].args[2]).toBe(str2hex('variant1,variant2'));
            expect(receipt.events[0].args[3]).toBe(str2hex('messageHash'));
            expect(receipt.events[0].args[4]).toBe(str2hex('false'));
            expect(parseInt(receipt.events[0].args[5], 16)).toBe(0);

            expect(receipt.events[1].event).toBe('_identity');
            expect(receipt.events[1].args.length).toBe(4);
        });
    });
});
