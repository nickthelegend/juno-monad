import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { describeValidator } from "@/lib/juno/staking";

/** Reading a `getValidator` answer from Monad's staking precompile. */
describe("describeValidator", () => {
  it("turns the precompile's tuple into MON and a commission percent", () => {
    // The shape testnet returned for validator #61 on 7 Oct (stake ≈ 10.99M MON, 0% commission).
    const tuple = [
      "0x1C2F30Ba19a32E63F8AE1493B99fbf815CC02b28",
      0n,
      10_999_674_922_345_681_130_914_892n,
      589_392_486_447_283_175_938_505_177_315_123_893n,
      0n,
      119_680_262_321_342_233_233_813n,
      10_999_674_922_345_681_130_914_892n,
      0n,
      10_999_674_922_345_681_130_914_892n,
      0n,
    ];
    const view = describeValidator(61n, tuple);
    expect(view.id).toBe(61);
    expect(view.authAddress).toBe("0x1C2F30Ba19a32E63F8AE1493B99fbf815CC02b28");
    expect(view.stakeMon).toBeCloseTo(10_999_674.922345, 4);
    expect(view.commissionPct).toBe(0);
    expect(view.unclaimedRewardsMon).toBeCloseTo(119_680.262321, 4);
  });

  it("reads a 1e18-scaled commission as a percent", () => {
    const view = describeValidator(3, ["0x0", 0n, 10n ** 18n, 0n, 5n * 10n ** 16n, 0n]);
    expect(view.commissionPct).toBe(5);
  });
});
