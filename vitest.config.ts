import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Transform every file with the root tsconfig. Left to discover the nearest
  // one, Vite would load `juno-expo/tsconfig.json` for the Expo helpers some
  // unit tests import — and that extends `expo/tsconfig.base`, which only
  // exists where `juno-expo/node_modules` is installed (not in the CI app job).
  tsconfig: "tsconfig.json",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The integration suite reads Monad testnet, Pyth and Tessera over public
    // endpoints that answer slowly under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The integration files share one public RPC endpoint and the gate in
    // `lib/juno/rpc.ts`. Running them in parallel only manufactures 429s, and
    // the unit suite is fast enough that serial costs nothing.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // `server-only` throws when imported outside a React Server Component
      // graph. Stub it so server modules can be tested directly.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
