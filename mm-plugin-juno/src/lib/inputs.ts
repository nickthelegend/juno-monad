import { InputFieldType, type InputSchema } from "@metamask/agent-wallet/plugin";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const tokenInput = {
  type: InputFieldType.Text,
  flag: "token",
  message: "The coin's token address (0x…). `mm juno markets` lists them",
  index: 0,
  prompt: true,
  validate: (value: string) => (ADDRESS.test(value) ? true : "a token address is 0x followed by 40 hex characters"),
} as const;

export const apiInput = {
  type: InputFieldType.Text,
  flag: "api",
  env: "JUNO_API_URL",
  message: "Juno's API (default: the hosted Monad testnet deployment)",
  required: false,
  prompt: false,
} as const;

export const positive = (label: string) => (value: string) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? true : `${label} must be a number greater than zero`;

export type { InputSchema };
