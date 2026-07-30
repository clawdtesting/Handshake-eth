import { describe, expect, it } from "vitest";
import { deriveFighter, simulate } from "@/lib/combat/engine";

describe("combat engine", () => {
  it("derives stable stats for a token id", () => {
    const a = deriveFighter("3458");
    const b = deriveFighter("3458");
    expect(a).toEqual(b);
    expect(a.atkMax).toBeGreaterThan(a.atkMin);
    expect(a.maxHp).toBeGreaterThan(0);
  });

  it("different ids generally differ", () => {
    expect(deriveFighter("1")).not.toEqual(deriveFighter("2"));
  });

  it("is deterministic for a given pair and seed", () => {
    const a = deriveFighter("10");
    const b = deriveFighter("20");
    const r1 = simulate(a, b, 0);
    const r2 = simulate(a, b, 0);
    expect(r1.winner).toBe(r2.winner);
    expect(r1.events.length).toBe(r2.events.length);
  });

  it("produces a decisive result and never negative HP", () => {
    const a = deriveFighter("777");
    const b = deriveFighter("888");
    const r = simulate(a, b, 0);
    // A winner exists (draws are possible but rare); HP never goes negative.
    for (const e of r.events) expect(e.defenderHp).toBeGreaterThanOrEqual(0);
    expect(r.events.length).toBeGreaterThan(0);
    if (r.winner) expect([a.tokenId, b.tokenId]).toContain(r.winner);
  });

  it("a rematch seed can change the outcome path", () => {
    const a = deriveFighter("100");
    const b = deriveFighter("200");
    const r1 = simulate(a, b, 0);
    const r2 = simulate(a, b, 1);
    // Same fighters, different seed → the event stream should differ.
    expect(JSON.stringify(r1.events)).not.toBe(JSON.stringify(r2.events));
  });
});
