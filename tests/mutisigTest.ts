import assert from "assert";
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram} from "@solana/web3.js";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";

describe("Test multisig", async () => {
    let provider: AnchorProvider;
    let program: Program;
    let dsl: MultisigDsl;
    before(async () => {
        let result = await setUpValidator();
        program = result.program;
        provider = result.provider;
        dsl = new MultisigDsl(program)
    })

    it("should create multisig account", async () => {

        const ownerA = Keypair.generate();
        const ownerB = Keypair.generate();
        const ownerC = Keypair.generate();
        const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
        const multisigSize = 200; // Big enough.
        const threshold = new BN(2);

        const multisig : MultisigAccount = await dsl.createMultisig(owners, multisigSize, threshold);

        let actualMultisig = await program.account.multisig.fetch(
            multisig.address
        );
        assert.strictEqual(actualMultisig.nonce, multisig.nonce);
        assert.ok(multisig.threshold.eq(actualMultisig.threshold));
        assert.deepStrictEqual(actualMultisig.owners, multisig.owners);
        assert.ok(actualMultisig.ownerSetSeqno === 0);
    });

});