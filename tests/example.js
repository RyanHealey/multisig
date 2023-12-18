const anchor = require("@project-serum/anchor");
const assert = require("assert");
const {AnchorProvider} = require("@project-serum/anchor");
const Fs = require("@supercharge/fs");
const {PublicKey} = require("@solana/web3.js");

// Configure the client to use the local cluster.
function loadKeypairFromFile(filename) {

    const secret = JSON.parse(Fs.readFileSync(filename).toString());
    const secretKey = Uint8Array.from(secret);
    return anchor.web3.Keypair.fromSecretKey(secretKey);
}

let payer = loadKeypairFromFile('/home/healeyr/.config/solana/id.json');
let nodeWallet = new anchor.Wallet(payer);
// let nodeWallet = anchor.NodeWallet.local();
let connection = new anchor.web3.Connection('http://127.0.0.1:8899', 'processed');
anchor.setProvider(new AnchorProvider(connection, nodeWallet, {
    commitment: 'processed',
    preflightCommitment: 'processed'
}));


const program = anchor.workspace.CoralMultisig;


async function createTx(multisigSigner, recipient, tx, multisig, transaction, ownerA, txSize, ownerB, ownerC, create) {
    const transfer = anchor.web3.SystemProgram.transfer(
        {
            fromPubkey: multisigSigner,
            lamports: new anchor.BN(1_000_000_000),
            toPubkey: recipient

        }
    )

    let propose = program.methods.createTransaction(transfer.programId, transfer.keys, transfer.data)
        .accounts(
            {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                proposer: ownerA.publicKey,
            });

    tx.add(create ? await propose.preInstructions(
        [
            await program.account.transaction.createInstruction(
                transaction,
                txSize
            ),
        ])
        .transaction() : await propose.transaction())

    // transfer.keys.forEach(key => console.log(key.pubkey.toBase58()))
    //
    // const txAccount = await program.account.transaction.fetch(
    //     transaction.publicKey
    // );
    //
    // assert.ok(txAccount.programId.equals(transfer.programId));
    // assert.deepStrictEqual(txAccount.accounts, transfer.keys);
    // assert.deepStrictEqual(txAccount.data, transfer.data);
    // assert.ok(txAccount.multisig.equals(multisig.publicKey));
    // assert.deepStrictEqual(txAccount.didExecute, false);
    // assert.ok(txAccount.ownerSetSeqno === 0);

    // Other owner approves transactoin.
    tx.add(await program.methods.approve()
        .accounts(
            {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                owner: ownerB.publicKey,
            })
        .transaction()
    )

    tx.add(await program.methods.approve()
        .accounts(
            {
                multisig: multisig.publicKey,
                transaction: transaction.publicKey,
                owner: ownerC.publicKey,
            })
        .transaction()
    )

    // Now that we've reached the threshold, send the transactoin.
    tx.add(await program.methods.executeTransaction()
        .accounts(
            {
                multisig: multisig.publicKey,
                multisigSigner,
                transaction: transaction.publicKey,
            })
        .remainingAccounts(transfer.keys
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
            })
        )
        .transaction()
    );
}

describe("multisig", () => {

    it("Tests the multisig program", async () => {

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
        const recipient = nodeWallet.publicKey
        const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey, ownerD.publicKey, ownerE.publicKey];

        const nonceAuthKeypair = payer;
        const nonceKeypair = anchor.web3.Keypair.generate();

        anchor.getProvider().sendAndConfirm(anchor.web3.SystemProgram.createNonceAccount(
            {
                fromPubkey: anchor.getProvider().wallet.publicKey,
                noncePubkey: nonceKeypair.publicKey,
                authorizedPubkey: nonceAuthKeypair.publicKey,
                lamports: 1_000_000_000
            }
        ), [nonceKeypair])

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

        const transaction = anchor.web3.Keypair.generate();

        const txSize = 1000; // Big enough, cuz I'm lazy.
        let nonceAdvance = anchor.web3.SystemProgram.nonceAdvance({
            noncePubkey: nonceKeypair.publicKey,
            authorizedPubkey: nonceAuthKeypair.publicKey
        });

        let nonceBlock = await anchor.getProvider().connection.getNonceAndContext(nonceKeypair.publicKey);
        let tx = new anchor.web3.Transaction(
            {
                nonceInfo: {
                    nonce: nonceBlock.value.nonce, nonceInstruction: nonceAdvance
                },
                minContextSlot: nonceBlock.context.slot
            }
        )
        await createTx(multisigSigner, recipient, tx, multisig, transaction, ownerA, txSize, ownerB, ownerC, true);

        await anchor.getProvider().sendAndConfirm(new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer(
            {
            fromPubkey: recipient,
            lamports: new anchor.BN(1_000_000_000),
            toPubkey: multisigSigner
        })))

        await anchor.getProvider().sendAndConfirm(tx, [transaction, ownerA, ownerB, ownerC, nonceAuthKeypair])

        await anchor.getProvider().sendAndConfirm(new anchor.web3.Transaction().add(anchor.web3.SystemProgram.nonceWithdraw(
            {
                noncePubkey: nonceKeypair.publicKey,
                authorizedPubkey: payer.publicKey,
                toPubkey: payer.publicKey,
                lamports: 1_000_000_000
            })))

        console.log(transaction.publicKey.toBase58())
        console.log(ownerA.publicKey.toBase58())
        console.log(ownerB.publicKey.toBase58())
        console.log(ownerC.publicKey.toBase58())
        console.log(nonceAuthKeypair.publicKey.toBase58())

        multisigAccount = await program.account.multisig.fetch(multisig.publicKey);
        //
        // assert.strictEqual(multisigAccount.nonce, nonce);
        // assert.ok(multisigAccount.threshold.eq(new anchor.BN(3)));
        // assert.deepStrictEqual(multisigAccount.owners, newOwners);
        // assert.ok(multisigAccount.ownerSetSeqno === 1);
    });

})
;
