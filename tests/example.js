const anchor = require("@project-serum/anchor");
const assert = require("assert");
const {AnchorProvider} = require("@project-serum/anchor");

// Configure the client to use the local cluster.
const payer = anchor.web3.Keypair.generate();
let nodeWallet = new anchor.Wallet(payer);
// let nodeWallet = anchor.NodeWallet.local();
let connection = new anchor.web3.Connection('http://127.0.0.1:8899', 'processed');
anchor.setProvider(new AnchorProvider(connection, nodeWallet, {
    commitment: 'processed',
    preflightCommitment: 'processed'
}));


const program = anchor.workspace.CoralMultisig;


describe("multisig", () => {

    it("Tests the multisig program", async () => {
        await anchor.getProvider().connection.requestAirdrop(payer.publicKey, 1000000000);
        const multisig = anchor.web3.Keypair.generate();
        const [multisigSigner, nonce] =
            await anchor.web3.PublicKey.findProgramAddress(
                [multisig.publicKey.toBuffer()],
                program.programId
            );
        const multisigSize = 200; // Big enough.

        const ownerA = anchor.web3.Keypair.generate();
        const ownerB = anchor.web3.Keypair.generate();
        const ownerC = anchor.web3.Keypair.generate();
        const ownerD = anchor.web3.Keypair.generate();
        const ownerE = anchor.web3.Keypair.generate();
        const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey, ownerD.publicKey, ownerE.publicKey];

        const threshold = new anchor.BN(3);
        await program.rpc.createMultisig(owners, threshold, nonce, {
            accounts: {
                multisig: multisig.publicKey,
            },
            instructions: [
                await program.account.multisig.createInstruction(
                    multisig,
                    multisigSize
                ),
            ],
            signers: [multisig],
        });

        let multisigAccount = await program.account.multisig.fetch(
            multisig.publicKey
        );
        assert.strictEqual(multisigAccount.nonce, nonce);
        assert.ok(multisigAccount.threshold.eq(new anchor.BN(3)));
        assert.deepStrictEqual(multisigAccount.owners, owners);
        assert.ok(multisigAccount.ownerSetSeqno === 0);

        const pid = program.programId;
        const accounts = [
            {
                pubkey: multisig.publicKey,
                isWritable: true,
                isSigner: false,
            },
            {
                pubkey: multisigSigner,
                isWritable: false,
                isSigner: true,
            },
        ];

        await anchor.getProvider().connection.requestAirdrop(multisigSigner, 1000000000);

        const transfer = anchor.web3.SystemProgram.transfer(
            {
                fromPubkey: multisigSigner,
                lamports: new anchor.BN(100000000),
                toPubkey: ownerA.publicKey

            }
        )

        const transaction = anchor.web3.Keypair.generate();
        const txSize = 1000; // Big enough, cuz I'm lazy.
        await program.rpc.createTransaction(transfer.programId, transfer.keys, transfer.data, {
            accounts: {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                proposer: ownerA.publicKey,
            },
            instructions: [
                await program.account.transaction.createInstruction(
                    transaction,
                    txSize
                ),
            ],
            signers: [transaction, ownerA],
        });

        transfer.keys.forEach(key => console.log(key.pubkey.toBase58()))

        const txAccount = await program.account.transaction.fetch(
            transaction.publicKey
        );

        assert.ok(txAccount.programId.equals(transfer.programId));
        assert.deepStrictEqual(txAccount.accounts, transfer.keys);
        assert.deepStrictEqual(txAccount.data, transfer.data);
        assert.ok(txAccount.multisig.equals(multisig.publicKey));
        assert.deepStrictEqual(txAccount.didExecute, false);
        assert.ok(txAccount.ownerSetSeqno === 0);

        // Other owner approves transactoin.
        await program.rpc.approve({
            accounts: {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                owner: ownerB.publicKey,
            },
            signers: [ownerB],
        });

        await program.rpc.approve({
            accounts: {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                owner: ownerC.publicKey,
            },
            signers: [ownerC],
        });

        // Now that we've reached the threshold, send the transactoin.
        await program.rpc.executeTransaction({
            accounts: {
                multisig: multisig.publicKey,
                multisigSigner,
                transaction: transaction.publicKey,
            },
            remainingAccounts: transfer.keys
                // Change the signer status on the vendor signer since it's signed by the program, not the client.
                .map((meta) =>
                    meta.pubkey.equals(multisigSigner)
                        ? {...meta, isSigner: false}
                        : meta
                )
                .concat({
                    pubkey: transfer.programId,
                    isWritable: false,
                    isSigner: false,
                }),
        });

        multisigAccount = await program.account.multisig.fetch(multisig.publicKey);

        assert.strictEqual(multisigAccount.nonce, nonce);
        assert.ok(multisigAccount.threshold.eq(new anchor.BN(2)));
        assert.deepStrictEqual(multisigAccount.owners, newOwners);
        assert.ok(multisigAccount.ownerSetSeqno === 1);
    });

});
