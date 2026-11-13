import { formatBallNumber } from "../client/format";

export type SelectionReceipt = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  selectionId: string;
  purchaseId: string;
  ballNumber: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export function receiptLink(origin: string, token: string): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}/purchase?token=${token}`;
}

export function buildSelectionReceipt(input: {
  to: string;
  from: string;
  buyerName: string | null;
  ballNumber: number;
  ballLabel: string;
  purchaseId: string;
  selectionId: string;
  reference: string;
  amountCents: number;
  numberPad: number;
  kind: "online_demo" | "offline_demo";
  receiptUrl: string;
}): SelectionReceipt {
  const ballNumber = input.ballNumber;
  const publicNumber = formatBallNumber(ballNumber, input.numberPad);
  const subject =
    input.kind === "offline_demo"
      ? `Demo only: ball ${publicNumber} recorded offline (no charge)`
      : `Demo only: ball ${publicNumber} recorded (no charge)`;
  const greeting = input.buyerName ? `Hello ${input.buyerName},` : "Hello,";
  const amount = money(input.amountCents);
  const recorded =
    input.kind === "offline_demo"
      ? `This demonstration recorded ${input.ballLabel} for ${input.to} as an offline club-table entry.`
      : `This demonstration recorded ${input.ballLabel} against ${input.to}.`;
  const text = [
    "Ladysmith Kinsmen — Running of the Balls (demonstration)",
    "Ladysmith, British Columbia, Canada",
    "",
    greeting,
    "",
    recorded,
    "No payment was taken by this app. No draw entry was created. This message is not a ticket.",
    "",
    `Demonstration amount shown on the record: ${amount} (placeholder, pending a decision).`,
    `Local reference: ${input.reference}`,
    `Selection: ${input.selectionId}`,
    `Your receipt: ${input.receiptUrl}`,
    "",
    "No further messages will be sent by this demo.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#fff6e8;color:#2a160f;font-family:Georgia,'Iowan Old Style',serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Demonstration receipt. No payment was taken.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff6e8;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf3;border:2px solid #2a160f;">
          <tr>
            <td style="padding:20px 24px 8px;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">Ladysmith Kinsmen</td>
          </tr>
          <tr>
            <td style="padding:0 24px 12px;font-size:28px;line-height:1.2;">Running of the Balls</td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-size:16px;line-height:1.5;">${escapeHtml(greeting)}</td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-size:16px;line-height:1.5;">${escapeHtml(recorded)} No payment was taken by this app. No draw entry was created. This message is not a ticket.</td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-size:16px;line-height:1.5;">Demonstration amount on the record: ${escapeHtml(amount)} (placeholder, pending a decision).<br>Local reference: ${escapeHtml(input.reference)}</td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-size:16px;line-height:1.5;"><a href="${escapeHtml(input.receiptUrl)}">Open your receipt</a></td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;font-size:14px;line-height:1.5;">Ladysmith Kinsmen, Ladysmith, British Columbia, Canada. No further messages will be sent by this demo.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    to: input.to,
    from: input.from,
    subject,
    html,
    text,
    idempotencyKey: `ball-selection/${input.selectionId}`,
    selectionId: input.selectionId,
    purchaseId: input.purchaseId,
    ballNumber,
  };
}
