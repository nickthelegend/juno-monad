// Load .env.local so the integration suite reaches Monad, Pyth and the
// launchpad the same way the server does. The unit suite depends on none of it.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Testnet unless something says otherwise: the integration suite only ever
// reads, and a missing variable must never point it at mainnet.
process.env.NEXT_PUBLIC_MONAD_NETWORK ||= "testnet";
