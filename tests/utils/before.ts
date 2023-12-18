import * as toml from "toml";
import * as fs from "fs";
import {mkdtemp} from "fs/promises";
import {exec} from "node:child_process";
import path from "node:path";
import * as os from "os";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import {AnchorProvider, Program, Wallet} from "@coral-xyz/anchor";
import shell from "shelljs";


export interface AnchorConfig {
    path: {
        idl_path: string;
        binary_path: string;
    };
    provider: {
        cluster: string;
        wallet: string;
    };
    programs: {
        localnet: {
            coral_multisig: string;
        };
    };
    validator: {
        ledger_dir: string;
    };
}

const PATH_TO_ANCHOR_CONFIG : string ="./Anchor.toml"

export const setUpValidator = async () : Promise<{ provider: AnchorProvider, program: Program }> => {
    const config = readAnchorConfig(PATH_TO_ANCHOR_CONFIG)
    const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "ledger-"));
    const user = loadKeypair(config.provider.wallet);
    const programAddress = new PublicKey(config.programs.localnet.coral_multisig);

    exec(`solana-test-validator --ledger ${ledgerDir} --mint ${user.publicKey} --bpf-program ${config.programs.localnet.coral_multisig} ${config.path.binary_path}`)

    const connection = new Connection("http://127.0.0.1:8899", "confirmed")
    const provider = new AnchorProvider(connection, new Wallet(user), {});

    const program = new Program(
        JSON.parse(fs.readFileSync(config.path.idl_path).toString()),
        programAddress,
        provider
    );
    // console.log(`anchor idl init -f ${config.path.idl_path} ${programAddress.toBase58()}  --provider.cluster ${
    //     connection.rpcEndpoint
    // }`)
    // shell.exec(
    //     `anchor idl init -f ${config.path.idl_path} ${programAddress.toBase58()}  --provider.cluster ${
    //         connection.rpcEndpoint
    //     }`
    // );


    return { program, provider }
}

export function readAnchorConfig(pathToAnchorToml: string): AnchorConfig {
    return toml.parse(
        fs.readFileSync(pathToAnchorToml).toString()
    );
}

export function loadKeypair(path: string) {
    return Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(path, "utf-8")))
    );
}