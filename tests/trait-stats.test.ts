import { describe, expect, it } from "vitest";
import {
  buildRarityIndex,
  deriveFighterFromTraits,
  effectForTrait,
} from "@/lib/combat/trait-stats";

const index = buildRarityIndex([
  {
    traitType: "clothes",
    values: [
      { value: "common tee", count: 500 }, // commonest
      { value: "rare suit", count: 5 }, // rare
    ],
  },
  { traitType: "specials", values: [{ value: "1/1 gold", count: 1 }] },
]);

describe("trait-stats", () => {
  it("maps traits to stats and ignores backgrounds", () => {
    expect(effectForTrait("clothes")).toBe("block");
    expect(effectForTrait("Backgrounds")).toBeNull();
    expect(effectForTrait("specials")).toBe("all");
  });

  it("rarer trait yields a higher stat than a common one", () => {
    const rare = deriveFighterFromTraits(
      "1",
      [{ traitType: "clothes", value: "rare suit" }],
      index,
    );
    const common = deriveFighterFromTraits(
      "2",
      [{ traitType: "clothes", value: "common tee" }],
      index,
    );
    expect(rare && common).toBeTruthy();
    expect(rare!.block).toBeGreaterThan(common!.block);
  });

  it("specials (1/1) max every stat", () => {
    const f = deriveFighterFromTraits(
      "3",
      [{ traitType: "specials", value: "1/1 gold" }],
      index,
    )!;
    expect(f.maxHp).toBe(260);
    expect(f.spd).toBe(140);
    expect(f.crit).toBe(35);
    expect(f.block).toBe(50);
  });

  it("returns null with no usable traits (caller falls back to id-hash)", () => {
    expect(deriveFighterFromTraits("4", [], index)).toBeNull();
    expect(
      deriveFighterFromTraits("5", [{ traitType: "backgrounds", value: "blue" }], index),
    ).toBeNull();
  });
});
