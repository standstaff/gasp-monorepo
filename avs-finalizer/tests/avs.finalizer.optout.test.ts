import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { DockerUtils } from "./DockerUtils";
import {
    createPublicClient, defineChain,
    webSocket,
} from "viem";

// @ts-ignore
import registryCoordinator from "./abis/RegistryCoordinator.json";
import {getOperatorId, waitFor, waitForOperatorDeRegistered, waitForOperatorRegistered} from "./operatorUtilities";
import {
    getLatestQuorumUpdate,
    validateBLSApkRegistry, validateOperatorOptInIndexRegistry,
    validateOperatorOptInStakeRegistry, validateOperatorOptOutIndexRegistry,
    validateOperatorOptOutStakeRegistry,
} from "./validators";
const registryCoordinatorAddress = '0x851356ae760d987E095750cCeb3bC6014560891C'


jest.setTimeout(1500000);

const anvil3 = defineChain({
    id: 31337,
    name: "anvil",
    network: "Anvil",
    nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH",
    },
    rpcUrls: {
        public: {
            http: ["ws://0.0.0.0:8545"],
        },
        default: {
            http: ["ws://0.0.0.0:8545"],
        },
    },
});
let dockerUtils: DockerUtils;

async function mineEthBlocks(blocks: number) {
    for (let i = 0; i < blocks; i++) {
        const host = anvil3.rpcUrls.default.http[0].replace("ws", "http");
        const myHeaders = new Headers();
        myHeaders.append("Content-Type", "application/json");
        const raw = JSON.stringify({
            method: "evm_mine",
            params: [],
            id: i,
            jsonrpc: "2.0",
        });
        const requestOptions = {
            method: "POST",
            headers: myHeaders,
            body: raw,
            redirect: "follow",
        };
        // @ts-ignore
        await fetch(host, requestOptions)
            .then((response) => response.text())
            .then((result) => console.log(result))
            .catch((error) => console.error(error));
    }

}

describe('AVS Finalizer', () => {
    it('opt-in / opt-out', async () => {
        dockerUtils = new DockerUtils();
        const transport = webSocket("ws://0.0.0.0:8545" , {
            retryCount: 5,
        });
        const publicClient = createPublicClient({
            transport,
            chain: anvil3,
        });
        const POperatorAddress = waitForOperatorRegistered(publicClient);
        await dockerUtils.startContainer();
        const operatorAddress = await POperatorAddress;
        console.log("operatorAddress: " + operatorAddress);
        const res = await publicClient.readContract({
            address: registryCoordinatorAddress,
            abi: registryCoordinator.abi,
            functionName: "getOperatorStatus",
            args: [operatorAddress],
        });
        expect(res).toBe(1);

        await validateOperatorOptInStakeRegistry(publicClient, operatorAddress as string);
        await validateOperatorOptInIndexRegistry(publicClient, operatorAddress as string);
        const statusBeforeOptOut = await getLatestQuorumUpdate(publicClient);

        const PoperatorDeregisteredAddress = waitForOperatorDeRegistered(publicClient);
        // opt-out
        await dockerUtils.container?.exec("./main opt-out-avs").then((result) => {
            console.log(result);
        }).catch((err) => {
            console.error(err);
        });
        const deRegistered = await PoperatorDeregisteredAddress;
        expect(deRegistered).toBe(operatorAddress);

        const statusAfter = await publicClient.readContract({
            address: registryCoordinatorAddress,
            abi: registryCoordinator.abi,
            functionName: "getOperatorStatus",
            args: [operatorAddress],
        });
        expect(statusAfter).toBe(2);
        const tasks = await waitFor(publicClient, 2, "TaskCompleted");
         expect(tasks).toHaveLength(2);

         //Test that after op-out the operator still has the bls keys in the registry
        await validateBLSApkRegistry(publicClient, operatorAddress as string , await getOperatorId(publicClient, operatorAddress as string) as string);
        await validateOperatorOptOutStakeRegistry(publicClient, operatorAddress as string);
        await validateOperatorOptOutIndexRegistry(publicClient, operatorAddress as string, statusBeforeOptOut);

    });
    it('operator that does not respond -> eject', async () => {
        dockerUtils = new DockerUtils();
        const transport = webSocket("ws://0.0.0.0:8545" , {
            retryCount: 5,
        });
        const publicClient = createPublicClient({
            transport,
            chain: anvil3,
        });
        const POperatorAddress = waitForOperatorRegistered(publicClient);
        await dockerUtils.startContainer();
        const operatorAddress = await POperatorAddress;
        console.log("operatorAddress: " + operatorAddress);
        const res = await publicClient.readContract({
            address: registryCoordinatorAddress,
            abi: registryCoordinator.abi,
            functionName: "getOperatorStatus",
            args: [operatorAddress],
        });
        expect(res).toBe(1);
        await dockerUtils.stopContainer();
        await mineEthBlocks(1);
        const statusBeforeOptOut = await getLatestQuorumUpdate(publicClient);

        const PoperatorDeregisteredAddress = waitForOperatorDeRegistered(publicClient);
        // 10s * 2 * 5 = 100s ( every two blocks we produce a task, and at 5th task we eject)
        const deRegistered = await PoperatorDeregisteredAddress;

        expect(deRegistered).toBe(operatorAddress);

        const statusAfter = await publicClient.readContract({
            address: registryCoordinatorAddress,
            abi: registryCoordinator.abi,
            functionName: "getOperatorStatus",
            args: [operatorAddress],
        });
        expect(statusAfter).toBe(2);
        await validateOperatorOptOutStakeRegistry(publicClient, operatorAddress as string);
        await validateOperatorOptOutIndexRegistry(publicClient, operatorAddress as string, statusBeforeOptOut);

    });
    afterEach(async () => {
        await dockerUtils.stopContainer();
    });
});
