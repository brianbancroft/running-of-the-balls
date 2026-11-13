// Open product decisions. A flag is true only after an operator sets the
// matching *_CONFIRMED var to the exact string true. Anything else stays pending.

export type DecisionFlags = {
  numbering: boolean;
  numberPad: boolean;
  price: boolean;
  bundles: boolean;
  assignment: boolean;
  prizes: boolean;
};

export type Prize = {
  place: string;
  amount: string;
};

export const PRIZE_PLACEHOLDER_COPY =
  "These amounts are a placeholder from past years, shown for flavour only. They are not this year's prize list.";

export const PRIZE_CONFIRMED_COPY =
  "These are the prizes configured for this year. This page does not state odds or how to claim a prize.";

export const PRIZE_PLACEHOLDER_BADGE = "Placeholder · prizes TBA";

export function anyDecisionPending(flags: DecisionFlags): boolean {
  return (
    !flags.numbering ||
    !flags.numberPad ||
    !flags.price ||
    !flags.bundles ||
    !flags.assignment ||
    !flags.prizes
  );
}

function oxford(items: string[]): string {
  const last = items[items.length - 1];
  if (last === undefined) return "";
  if (items.length === 1) return last;
  const first = items[0];
  if (items.length === 2 && first !== undefined) return `${first} and ${last}`;
  return `${items.slice(0, -1).join(", ")}, and ${last}`;
}

export function openDecisionCopy(input: {
  flags: DecisionFlags;
  sampleNumber: string;
  priceLabel: string;
  bundleSummary: string;
  assignment: "buyer_picks" | "assigned";
}): string | null {
  const parts: string[] = [];
  if (!input.flags.numbering) parts.push("the numbering scheme (numbers run from 1)");
  if (!input.flags.numberPad) {
    parts.push(`how numbers are labelled (ball 7 is shown as ${input.sampleNumber})`);
  }
  if (!input.flags.price) {
    parts.push(`the ticket price (${input.priceLabel} a ball, not a ticket price)`);
  }
  if (!input.flags.bundles) parts.push(`bundles (${input.bundleSummary})`);
  if (!input.flags.assignment) {
    parts.push(
      input.assignment === "buyer_picks"
        ? "whether a buyer picks a number or is assigned one (this demo lets a buyer pick a ball)"
        : "whether a buyer picks a number or is assigned one (this demo assigns an open ball)",
    );
  }
  if (!input.flags.prizes) parts.push("this year's prizes");
  if (parts.length === 0) return null;
  return `Pending a decision: ${oxford(parts)}.`;
}

export function figurePlaceholderNote(flags: DecisionFlags): string {
  if (!flags.price && !flags.prizes) return "Prices and prizes shown are placeholders.";
  if (!flags.price) return "The price shown is a placeholder.";
  if (!flags.prizes) return "Prizes shown are placeholders.";
  return "";
}

export function pendingSummary(flags: DecisionFlags): string {
  const names: string[] = [];
  if (!flags.numbering) names.push("the numbering scheme");
  if (!flags.numberPad) names.push("how numbers are labelled");
  if (!flags.price) names.push("the ticket price");
  if (!flags.bundles) names.push("bundles");
  if (!flags.assignment) names.push("whether a buyer picks a number or is assigned one");
  if (!flags.prizes) names.push("this year's prizes");
  const base = "Demo build · payments in Stripe test mode";
  if (names.length === 0) return base;
  return `${base} · Pending a decision: ${oxford(names)}.`;
}

export function rulesPlaceholderCopy(rulesUrl: string): string {
  if (rulesUrl === "/rules") {
    return "When the club sets a rules URL, the footer link follows that URL. Until then, this placeholder is the rules link.";
  }
  return "The rules link follows the configured URL. This page is still not the club's licence terms.";
}

export function demonstrationAmountClause(priceConfirmed: boolean): string {
  return priceConfirmed ? "demonstration amount, not a charge" : "placeholder, pending a decision";
}

// The test receipt used to stamp "Pending a decision" on every row, including
// the Stripe test card, the reference, and race day. Only an unconfirmed price
// gets that label, and only on the amount.
export function pricePendingOnReceiptRow(label: string, priceConfirmed: boolean): boolean {
  return label === "Amount" && !priceConfirmed;
}
