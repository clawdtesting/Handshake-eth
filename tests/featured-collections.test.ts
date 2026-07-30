import { describe, it, expect } from "vitest";
import {
  FEATURED_COLLECTIONS,
  collectionApprovalDetail,
  collectionTradeStatus,
} from "@/lib/featured-collections";

describe("collectionTradeStatus", () => {
  it("gated collection with neither approval is locked (red)", () => {
    expect(
      collectionTradeStatus(
        { transferValidator: true },
        { validatorApproved: false, handshakeAllowed: false },
      ),
    ).toBe("locked");
    // Missing signals default to not-approved.
    expect(collectionTradeStatus({ transferValidator: true })).toBe("locked");
  });

  it("gated collection with exactly one approval is pending (yellow)", () => {
    expect(
      collectionTradeStatus(
        { transferValidator: true },
        { validatorApproved: true, handshakeAllowed: false },
      ),
    ).toBe("pending");
    expect(
      collectionTradeStatus(
        { transferValidator: true },
        { validatorApproved: false, handshakeAllowed: true },
      ),
    ).toBe("pending");
  });

  it("gated collection with both approvals is open (green)", () => {
    expect(
      collectionTradeStatus(
        { transferValidator: true },
        { validatorApproved: true, handshakeAllowed: true },
      ),
    ).toBe("open");
  });

  it("manual settlementApproved override satisfies the validator condition", () => {
    // Validator approved manually, Handshake allow still missing → pending.
    expect(
      collectionTradeStatus(
        { transferValidator: true, settlementApproved: true },
        { handshakeAllowed: false },
      ),
    ).toBe("pending");
    // Both satisfied → open.
    expect(
      collectionTradeStatus(
        { transferValidator: true, settlementApproved: true },
        { handshakeAllowed: true },
      ),
    ).toBe("open");
  });

  it("non-validator collection needs only the Handshake allowlist", () => {
    // No validator gate → validator condition is always met.
    expect(
      collectionTradeStatus(
        { transferValidator: false },
        { handshakeAllowed: true },
      ),
    ).toBe("open");
    // Not yet allowlisted → pending, never locked (nothing else to approve).
    expect(
      collectionTradeStatus(
        { transferValidator: false },
        { handshakeAllowed: false },
      ),
    ).toBe("pending");
  });

  it("with no live signals: status follows the two curated approval flags", () => {
    for (const c of FEATURED_COLLECTIONS) {
      const status = collectionTradeStatus(c);
      // Validator condition met when un-gated or explicitly settlement-approved;
      // Handshake condition met via the curated allowlist override.
      const validatorOk = !c.transferValidator || c.settlementApproved === true;
      const handshakeOk = c.allowlisted === true;
      const met = (validatorOk ? 1 : 0) + (handshakeOk ? 1 : 0);
      const expected = met === 2 ? "open" : met === 1 ? "pending" : "locked";
      expect(status).toBe(expected);
    }
  });
});

describe("collectionApprovalDetail", () => {
  it("un-gated pending collection: the missing approval is the Handshake allowlist", () => {
    // T00ns-shaped: no transfer-validator gate, not yet allowlisted.
    const detail = collectionApprovalDetail(
      { transferValidator: undefined },
      { handshakeAllowed: false },
    );
    expect(detail.status).toBe("pending");
    expect(detail.validatorGated).toBe(false);
    expect(detail.validatorOk).toBe(true); // nothing to approve on the validator
    expect(detail.handshakeOk).toBe(false); // this is the one that's missing
  });

  it("allowlisted display override makes an un-gated collection open with no live signals", () => {
    const detail = collectionApprovalDetail({ allowlisted: true });
    expect(detail.status).toBe("open");
    expect(detail.validatorOk).toBe(true);
    expect(detail.handshakeOk).toBe(true);
  });

  it("un-gated collection is open once the Handshake allowlist lists it", () => {
    const detail = collectionApprovalDetail(
      { transferValidator: undefined },
      { handshakeAllowed: true },
    );
    expect(detail.status).toBe("open");
    expect(detail.handshakeOk).toBe(true);
  });

  it("gated collection with only the allowlist met is pending on the validator", () => {
    const detail = collectionApprovalDetail(
      { transferValidator: true },
      { handshakeAllowed: true, validatorApproved: false },
    );
    expect(detail.status).toBe("pending");
    expect(detail.validatorGated).toBe(true);
    expect(detail.validatorOk).toBe(false); // validator authorization is missing
    expect(detail.handshakeOk).toBe(true);
  });

  it("gated collection with neither approval is locked", () => {
    const detail = collectionApprovalDetail({ transferValidator: true });
    expect(detail.status).toBe("locked");
    expect(detail.validatorOk).toBe(false);
    expect(detail.handshakeOk).toBe(false);
  });

  it("status matches collectionTradeStatus for the same inputs", () => {
    const signals = { handshakeAllowed: true } as const;
    const c = { transferValidator: true, settlementApproved: true } as const;
    expect(collectionApprovalDetail(c, signals).status).toBe(
      collectionTradeStatus(c, signals),
    );
  });
});
