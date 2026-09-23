import { defineConfig } from "vitest/config";

// Without its own config, vitest would pick up the Next app's one in the parent
// directory (which only looks in tests/ and stubs app modules).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      // A launchpad address that is not the zero address, so the tests can tell
      // "the launchpad's own inventory" from "mint/burn".
      ENVIO_JUNO_TESTNET_LAUNCHPAD: "0x1111111111111111111111111111111111111111",
    },
  },
});
