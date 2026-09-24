import { defineConfig } from "vitest/config";

// Without its own config, vitest would pick up the Next app's one in the parent
// directory (which only looks in tests/ and stubs app modules).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pinned here because Envio also reads indexer/.env, whose values are for a
    // real run: a start block from a live deployment would filter out every
    // simulated event below it.
    env: {
      ENVIO_JUNO_TESTNET_START_BLOCK: "0",
      ENVIO_JUNO_SKIP_MAINNET: "true",
      // A launchpad address that is not the zero address, so the tests can tell
      // "the launchpad's own inventory" from "mint/burn".
      ENVIO_JUNO_TESTNET_LAUNCHPAD: "0x1111111111111111111111111111111111111111",
      ENVIO_JUNO_TESTNET_KURU_GRADUATOR: "0x2222222222222222222222222222222222222222",
    },
  },
});
