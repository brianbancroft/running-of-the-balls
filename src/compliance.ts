export const BUYER_ATTESTATION_TEXT =
  "I am 19 or older and I am physically in British Columbia.";

export const ADMIN_ATTESTATION_TEXT =
  "The buyer confirmed they are 19 or older and physically in British Columbia.";

export const UNLICENSED_BANNER = "Demo — not licensed, no real tickets sold.";

export function licenceNotice(licenceNumber: string | null): string {
  if (!licenceNumber) return UNLICENSED_BANNER;
  return `BC Gaming Event Licence #${licenceNumber}`;
}
