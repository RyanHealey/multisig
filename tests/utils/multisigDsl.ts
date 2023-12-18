import {Keypair, PublicKey} from "@solana/web3.js";
import {BN, Program} from "@coral-xyz/anchor";

export interface MultisigAccount
{
    address: PublicKey;
    signer: PublicKey;
    nonce: number;
    owners: Array<PublicKey>;
    threshold: BN;
    size: number;
}

export class MultisigDsl {
    readonly program: Program

    constructor(program: Program)
    {
        this.program = program
    };

    async createMultisig(owners : Array<PublicKey>, multisigSize: number, threshold: BN) {
        const multisig = Keypair.generate();

        const [multisigSigner, nonce] =
            PublicKey.findProgramAddressSync(
                [multisig.publicKey.toBuffer()],
                this.program.programId
            );

        await this.program.methods.createMultisig(owners, threshold, nonce)
            .accounts({
                multisig: multisig.publicKey,
            })
            .preInstructions(
                [
                    await this.program.account.multisig.createInstruction(
                        multisig,
                        multisigSize
                    )
                ]
            )
            .signers([multisig])
            .rpc()
        return {
            address: multisig.publicKey,
            signer: multisigSigner,
            nonce: nonce,
            owners: owners,
            threshold: threshold,
            size: multisigSize
        };
    }
}