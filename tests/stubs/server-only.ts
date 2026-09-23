// Stub for the `server-only` package. The real module throws when imported
// outside a React Server Component graph; under Vitest we want a no-op so the
// server modules in `lib/juno/` (swaps, tx, profiles, …) can be imported and
// tested directly. Aliased in `vitest.config.ts`.
export {};
