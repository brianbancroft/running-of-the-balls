import { Resend } from "resend";
import type { SelectionReceipt } from "./receipt";
import { logError, logInfo } from "../log";

export type EmailDeliveryMode = "dry_run" | "resend";

export type EmailDispatchPlan = {
  mode: EmailDeliveryMode;
  shouldSend: boolean;
  reason: string | null;
};

export type EmailDeliveryResult = {
  mode: EmailDeliveryMode;
  status: "previewed" | "sent" | "failed";
  sent: boolean;
  idempotencyKey: string;
  providerMessageId: string | null;
  error: string | null;
  reason: string | null;
  preview: {
    to: string;
    from: string;
    subject: string;
    text: string;
  };
};

export function planEmailDelivery(input: {
  delivery: string;
  apiKey: string | undefined;
}): EmailDispatchPlan {
  if (input.delivery === "resend" && input.apiKey) {
    return { mode: "resend", shouldSend: true, reason: null };
  }
  if (input.delivery === "resend") {
    return {
      mode: "dry_run",
      shouldSend: false,
      reason: "RESEND_API_KEY is not set, so nothing was sent.",
    };
  }
  return {
    mode: "dry_run",
    shouldSend: false,
    reason: "EMAIL_DELIVERY is dry_run, so nothing was sent.",
  };
}

export function previewResult(
  receipt: SelectionReceipt,
  plan: EmailDispatchPlan,
): EmailDeliveryResult {
  return {
    mode: plan.mode,
    status: "previewed",
    sent: false,
    idempotencyKey: receipt.idempotencyKey,
    providerMessageId: null,
    error: null,
    reason: plan.reason,
    preview: {
      to: receipt.to,
      from: receipt.from,
      subject: receipt.subject,
      text: receipt.text,
    },
  };
}

/**
 * Sends one transactional demo receipt through Resend.
 * Callers must already have decided `shouldSend` is true. Dry-run never reaches here.
 * The SDK returns `{ data, error }` and does not throw for API failures.
 */
export async function sendSelectionReceipt(
  receipt: SelectionReceipt,
  apiKey: string,
): Promise<EmailDeliveryResult> {
  const resend = new Resend(apiKey);
  const payload = {
    from: receipt.from,
    to: [receipt.to],
    subject: receipt.subject,
    html: receipt.html,
    text: receipt.text,
    tags: [{ name: "category", value: "demo_ball_selection" }],
  };

  try {
    const { data, error } = await resend.emails.send(payload, {
      idempotencyKey: receipt.idempotencyKey,
    });
    if (error) {
      logError({
        message: "demo receipt was not accepted",
        selectionId: receipt.selectionId,
        statusCode: error.statusCode,
        error: error.message,
      });
      return {
        mode: "resend",
        status: "failed",
        sent: false,
        idempotencyKey: receipt.idempotencyKey,
        providerMessageId: null,
        error: error.message,
        reason: null,
        preview: previewOf(receipt),
      };
    }
    logInfo({
      message: "demo receipt accepted",
      selectionId: receipt.selectionId,
      providerMessageId: data?.id ?? null,
    });
    return {
      mode: "resend",
      status: "sent",
      sent: true,
      idempotencyKey: receipt.idempotencyKey,
      providerMessageId: data?.id ?? null,
      error: null,
      reason: null,
      preview: previewOf(receipt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    logError({
      message: "demo receipt send threw",
      selectionId: receipt.selectionId,
      error: message,
    });
    return {
      mode: "resend",
      status: "failed",
      sent: false,
      idempotencyKey: receipt.idempotencyKey,
      providerMessageId: null,
      error: message,
      reason: null,
      preview: previewOf(receipt),
    };
  }
}

function previewOf(receipt: SelectionReceipt): EmailDeliveryResult["preview"] {
  return {
    to: receipt.to,
    from: receipt.from,
    subject: receipt.subject,
    text: receipt.text,
  };
}
