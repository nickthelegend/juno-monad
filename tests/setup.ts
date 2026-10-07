// Load .env.local so the integration suite reaches Monad, Pyth and the
// launchpad the same way the server does. The unit suite depends on none of it.
import net from "node:net";

import { config } from "dotenv";
import { expect } from "vitest";

config({ path: ".env.local", quiet: true });

// Testnet unless something says otherwise: the integration suite only ever
// reads, and a missing variable must never point it at mainnet.
process.env.NEXT_PUBLIC_MONAD_NETWORK ||= "testnet";

/*
 * The unit suite runs offline, and this holds it to that. `.env.local` exists
 * on a developer's machine and not in CI, so a unit test that reached a real
 * endpoint by accident would pass in CI and fail here whenever that endpoint
 * was slow. Any socket a unit test opens is refused, naming the file.
 */
const GUARD = Symbol.for("juno.unitTestsOffline");
const socket = net.Socket.prototype as net.Socket & { [GUARD]?: true };
if (!socket[GUARD]) {
  const connect = socket.connect;
  socket.connect = function (this: net.Socket, ...args: unknown[]) {
    const file = expect.getState().testPath ?? "";
    if (file.includes("/tests/unit/")) {
      const message = `${file.split("/").pop()} opened a network connection. Unit tests run offline: mock the call, or move the test to tests/integration.`;
      console.error(message);
      throw new Error(message);
    }
    return connect.apply(this, args as never);
  } as typeof connect;
  socket[GUARD] = true;
}
