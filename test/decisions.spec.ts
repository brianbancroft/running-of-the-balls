import { describe, expect, it } from "vitest";
import { parsePrizes } from "../src/config";
import {
  anyDecisionPending,
  demonstrationAmountClause,
  figurePlaceholderNote,
  openDecisionCopy,
  pendingSummary,
  pricePendingOnReceiptRow,
  rulesPlaceholderCopy,
  type DecisionFlags,
} from "../src/client/decisions";

const pending: DecisionFlags = {
  numbering: false,
  numberPad: false,
  price: false,
  bundles: false,
  assignment: false,
  prizes: false,
};

const confirmed: DecisionFlags = {
  numbering: true,
  numberPad: true,
  price: true,
  bundles: true,
  assignment: true,
  prizes: true,
};

describe("open decisions", () => {
  it("names only the decisions that are still unconfirmed", () => {
    const all = openDecisionCopy({
      flags: pending,
      sampleNumber: "007",
      priceLabel: "$5.00",
      bundleSummary: "none are offered",
      assignment: "buyer_picks",
    });
    expect(all).toContain("Pending a decision:");
    expect(all).toContain("numbering scheme");
    expect(all).toContain("007");
    expect(all).toContain("$5.00");
    expect(all).toContain("this year's prizes");

    const priceOnly = openDecisionCopy({
      flags: { ...confirmed, price: false },
      sampleNumber: "007",
      priceLabel: "$5.00",
      bundleSummary: "none are offered",
      assignment: "buyer_picks",
    });
    expect(priceOnly).toBe("Pending a decision: the ticket price ($5.00 a ball, not a ticket price).");
    expect(openDecisionCopy({
      flags: confirmed,
      sampleNumber: "007",
      priceLabel: "$5.00",
      bundleSummary: "none are offered",
      assignment: "buyer_picks",
    })).toBeNull();
    expect(anyDecisionPending(pending)).toBe(true);
    expect(anyDecisionPending(confirmed)).toBe(false);
    expect(anyDecisionPending({ ...confirmed, prizes: false })).toBe(true);
  });

  it("drops the placeholder note once price and prizes are confirmed", () => {
    expect(figurePlaceholderNote(pending)).toBe("Prices and prizes shown are placeholders.");
    expect(figurePlaceholderNote({ ...confirmed, price: false })).toBe("The price shown is a placeholder.");
    expect(figurePlaceholderNote({ ...confirmed, prizes: false })).toBe("Prizes shown are placeholders.");
    expect(figurePlaceholderNote(confirmed)).toBe("");
    expect(pendingSummary(confirmed)).toBe("Demo build · payments in Stripe test mode");
    expect(pendingSummary({ ...confirmed, bundles: false })).toContain("Pending a decision: bundles.");
    expect(pendingSummary({ ...confirmed, bundles: false })).not.toContain("ticket price");
  });

  it("marks only an unconfirmed amount on the test receipt", () => {
    expect(pricePendingOnReceiptRow("Amount", false)).toBe(true);
    expect(pricePendingOnReceiptRow("Amount", true)).toBe(false);
    expect(pricePendingOnReceiptRow("Paid with", false)).toBe(false);
    expect(pricePendingOnReceiptRow("Reference", false)).toBe(false);
    expect(pricePendingOnReceiptRow("Race day", false)).toBe(false);
    expect(demonstrationAmountClause(false)).toContain("pending a decision");
    expect(demonstrationAmountClause(true)).not.toContain("pending");
    expect(rulesPlaceholderCopy("/rules")).toContain("placeholder is the rules link");
    expect(rulesPlaceholderCopy("https://example.com/rules")).toContain("still not the club's licence terms");
  });

  it("accepts a place and an amount and refuses odds", () => {
    expect(parsePrizes('[{"place":"1st down","amount":"$500"}]')).toEqual([
      { place: "1st down", amount: "$500" },
    ]);
    expect(parsePrizes("[]")).toEqual([]);
    expect(() => parsePrizes("not-json")).toThrow(/PRIZE_PODIUM/);
    expect(() => parsePrizes('[{"place":"1st","amount":"$1","odds":"1 in 2"}]')).toThrow(/Odds/);
    expect(() => parsePrizes('[{"place":"<b>1st</b>","amount":"$1"}]')).toThrow(/HTML/);
  });
});
