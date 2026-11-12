/* Generated into public/app.js by `npm run build:client`. Edit this file, not public/app.js. */

type BallStatus = "available" | "selected" | "sold";
type PurchaseStatus = "demo_pending" | "demo_confirmed" | "cancelled";
type PaymentMode = "stripe_test_fake" | "offline_demo";

type Ball = {
  id: number;
  ballNumber: number;
  label: string;
  color: string;
  status: BallStatus;
};

type Config = {
  allowBallPicking: boolean;
  amountCents: number;
  currency: string;
  emailDelivery: string;
  paymentsBlocked: boolean;
  offlineSalesConfigured: boolean;
  disclaimer: string;
};

type StoredEmail = {
  id: string;
  subject: string;
  status: "previewed" | "sent" | "failed";
  sent: boolean;
  mode: "dry_run" | "resend";
};

type Purchase = {
  id: string;
  status: PurchaseStatus;
  paymentMode: PaymentMode;
  charged: false;
  amountCents: number;
  currency: string;
  stripeTestReference: string | null;
  offlineNote: string | null;
  buyerEmail: string;
  buyerName: string | null;
  selectionId: string;
  ball: Ball;
  emailRecord: StoredEmail | null;
  createdAt: string;
};

type Selection = {
  id: string;
  email: string;
  ballNumber: number;
  label: string;
  ballStatus: BallStatus;
  purchaseId: string;
  purchaseStatus: PurchaseStatus;
  emailRecord: StoredEmail | null;
  createdAt: string;
};

type EmailResult = {
  sent: boolean;
  mode: string;
  reason: string | null;
  error: string | null;
  preview: { subject: string; text: string };
};

type ApiError = { error?: string };

async function getJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

function statusWord(status: BallStatus): string {
  if (status === "selected") return "Held";
  if (status === "sold") return "Sold";
  return "Open";
}

function purchaseWord(status: PurchaseStatus): string {
  if (status === "demo_pending") return "Held";
  if (status === "demo_confirmed") return "Recorded";
  return "Cancelled";
}

function paymentWord(mode: PaymentMode): string {
  return mode === "offline_demo" ? "Offline demo record" : "Demo card placeholder";
}

function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) return [];
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function renderMarquee(balls: readonly Ball[]): void {
  const root = document.querySelector("#marquee");
  if (!root) return;
  root.replaceChildren();
  [0, 7, 15].forEach((offset, index) => {
    const row = document.createElement("div");
    row.className = "marquee-row";
    const track = document.createElement("div");
    track.className = "marquee-track";
    if (index === 1) track.classList.add("is-reverse");
    if (index === 2) track.classList.add("is-slow");
    for (let copy = 0; copy < 2; copy += 1) {
      for (const ball of rotate(balls, offset)) {
        const mini = document.createElement("div");
        mini.className = `mini is-${ball.status}`;
        mini.style.setProperty("--ball", ball.color);
        mini.textContent = String(ball.ballNumber);
        track.append(mini);
      }
    }
    row.append(track);
    root.append(row);
  });
}

function field(labelText: string, input: HTMLInputElement | HTMLTextAreaElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(labelText, input);
  return label;
}

function textInput(type: string, name: string, required = false): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.autocomplete = name === "email" ? "email" : "name";
  if (required) input.required = true;
  if (type === "email") input.maxLength = 254;
  if (name === "buyerName") input.maxLength = 80;
  return input;
}

function actionButton(label: string, secondary = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary ? "action secondary" : "action";
  button.textContent = label;
  return button;
}

function messageNode(text: string, isError = false): HTMLParagraphElement {
  const node = document.createElement("p");
  node.textContent = text;
  if (isError) node.className = "error";
  return node;
}

async function loadBalls(): Promise<Ball[]> {
  const payload = await getJson<{ balls: Ball[] }>("/api/balls");
  return payload.balls;
}

function paintBoard(
  root: HTMLElement,
  balls: readonly Ball[],
  options: { picking: boolean; activeId: number | null; onPick: (ball: Ball) => void },
): void {
  root.replaceChildren();
  for (const ball of balls) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ball is-${ball.status}`;
    if (ball.id === options.activeId) button.classList.add("is-chosen");
    button.style.setProperty("--ball", ball.color);
    const open = options.picking && ball.status === "available";
    button.disabled = !open;
    button.setAttribute("aria-label", `${ball.label}, ${statusWord(ball.status)}`);
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(ball.ballNumber);
    button.append(num);
    if (open) button.addEventListener("click", () => options.onPick(ball));
    const caption = document.createElement("span");
    caption.className = "slot-label";
    caption.textContent = statusWord(ball.status);
    slot.append(button, caption);
    root.append(slot);
  }
}

function startBoard(config: Config, initial: Ball[]): void {
  const boardQuery = document.querySelector("#board");
  const panelQuery = document.querySelector("#panel");
  const countsQuery = document.querySelector("#counts");
  if (
    !(boardQuery instanceof HTMLElement) ||
    !(panelQuery instanceof HTMLElement) ||
    !(countsQuery instanceof HTMLElement)
  ) {
    return;
  }
  const board = boardQuery;
  const panel = panelQuery;
  const counts = countsQuery;
  let balls = initial;
  let active: Ball | null = null;
  let busy = false;
  let notice: string | null = null;
  let receipt: { purchase: Purchase; email: EmailResult } | null = null;

  const refreshCounts = () => {
    const open = balls.filter((ball) => ball.status === "available").length;
    const held = balls.filter((ball) => ball.status === "selected").length;
    const sold = balls.filter((ball) => ball.status === "sold").length;
    counts.textContent = `${open} open · ${held} held · ${sold} recorded`;
  };

  const draw = () => {
    refreshCounts();
    paintBoard(board, balls, {
      picking: config.allowBallPicking && !config.paymentsBlocked,
      activeId: active?.id ?? null,
      onPick(ball) {
        active = ball;
        receipt = null;
        draw();
      },
    });
    panel.replaceChildren();
    if (config.paymentsBlocked) {
      panel.append(messageNode("Purchases are blocked because a live or unrecognized Stripe key is configured.", true));
      return;
    }
    const amount = money(config.amountCents, config.currency);
    const receiptMode = config.emailDelivery === "dry_run" ? "previewed and not sent" : "sent with Resend";
    panel.append(messageNode(`Demonstration amount ${amount}. It is not charged. Receipts are ${receiptMode}.`));
    if (notice) panel.append(messageNode(notice, true));
    if (receipt) {
      panel.append(renderReceipt(receipt.purchase, receipt.email));
      return;
    }
    const form = document.createElement("form");
    form.className = "stack";
    const name = textInput("text", "buyerName");
    const email = textInput("email", "email", true);
    const submit = actionButton(
      config.allowBallPicking ? "Buy this ball (no charge)" : "Buy the next open ball (no charge)",
    );
    submit.type = "submit";
    submit.disabled = busy || (config.allowBallPicking && !active);
    form.append(field("Name (optional)", name), field("Email", email), submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitBuy(config.allowBallPicking ? active?.id : undefined, name.value, email.value);
    });
    if (config.allowBallPicking && !active) {
      panel.append(messageNode("Choose an open ball. Shaded balls are already held or recorded."));
    } else if (active) {
      panel.append(messageNode(`${active.label} is open. Buying it locks the ball.`));
    } else {
      panel.append(messageNode("Buying assigns the next open ball and locks it."));
    }
    panel.append(form);
  };

  async function reload() {
    balls = await loadBalls();
    renderMarquee(balls);
    const current = active ? balls.find((ball) => ball.id === active?.id) : undefined;
    active = current ?? null;
  }

  async function submitBuy(ballId: number | undefined, buyerName: string, email: string) {
    if (config.allowBallPicking && ballId == null) return;
    busy = true;
    notice = null;
    draw();
    try {
      const result = await postJson<{ purchase: Purchase; email: EmailResult }>("/api/purchases", {
        email,
        buyerName,
        ballId,
      });
      await reload();
      active = null;
      receipt = result;
    } catch (error) {
      notice = error instanceof Error ? error.message : "Could not buy that ball.";
    } finally {
      busy = false;
      draw();
    }
  }

  draw();
}

function renderReceipt(purchase: Purchase, email: EmailResult): HTMLElement {
  const box = document.createElement("div");
  box.className = "receipt";
  const sent = email.sent ? "Email was handed to Resend." : "The receipt was stored. No email was sent.";
  box.append(
    messageNode(`${purchase.ball.label} is ${purchaseWord(purchase.status).toLowerCase()}. ${sent} Charged: no.`),
    messageNode(email.reason ?? email.preview.subject),
  );
  const pre = document.createElement("pre");
  pre.textContent = email.preview.text;
  const purchases = document.createElement("a");
  purchases.href = `/purchase?email=${encodeURIComponent(purchase.buyerEmail)}`;
  purchases.textContent = "View purchases for this email";
  const selections = document.createElement("a");
  selections.href = `/selections?email=${encodeURIComponent(purchase.buyerEmail)}`;
  selections.textContent = "View the email and ball record";
  box.append(pre, purchases, document.createElement("br"), selections);
  return box;
}

function purchaseCard(purchase: Purchase): HTMLElement {
  const card = document.createElement("article");
  card.className = "record";
  const title = document.createElement("h3");
  title.textContent = purchase.ball.label;
  const receiptLine = purchase.emailRecord
    ? `Receipt “${purchase.emailRecord.subject}” — ${purchase.emailRecord.sent ? "sent" : "stored, not sent"}.`
    : "No receipt stored for this row.";
  card.append(
    title,
    messageNode(`${purchaseWord(purchase.status)} · ${paymentWord(purchase.paymentMode)}`),
    messageNode(`Amount on the record: ${money(purchase.amountCents, purchase.currency)}. Charged: no.`),
    messageNode(receiptLine),
    messageNode(
      purchase.stripeTestReference
        ? `Local reference: ${purchase.stripeTestReference}`
        : purchase.offlineNote ?? "No Stripe reference.",
    ),
  );
  return card;
}

function lookupForm(onSearch: (email: string) => void, preset: string): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "stack";
  const email = textInput("email", "email", true);
  email.value = preset;
  const submit = actionButton("Look up");
  submit.type = "submit";
  form.append(field("Email", email), submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSearch(email.value.trim());
  });
  return form;
}

function startPurchases(): void {
  const panelQuery = document.querySelector("#panel");
  const resultsQuery = document.querySelector("#results");
  if (!(panelQuery instanceof HTMLElement) || !(resultsQuery instanceof HTMLElement)) return;
  const panel = panelQuery;
  const results = resultsQuery;
  const preset = new URLSearchParams(window.location.search).get("email") ?? "";
  panel.append(lookupForm((email) => void show(email), preset));

  async function show(email: string) {
    results.replaceChildren(messageNode("Loading purchases…"));
    try {
      const payload = await getJson<{ purchases: Purchase[] }>(
        `/api/purchases?email=${encodeURIComponent(email)}`,
      );
      results.replaceChildren();
      if (payload.purchases.length === 0) {
        results.append(messageNode("No demo purchases for that email."));
        return;
      }
      for (const purchase of payload.purchases) {
        results.append(purchaseCard(purchase));
      }
    } catch (error) {
      results.replaceChildren(messageNode(error instanceof Error ? error.message : "Lookup failed.", true));
    }
  }

  if (preset) void show(preset);
}

function startSelections(): void {
  const panelQuery = document.querySelector("#panel");
  const resultsQuery = document.querySelector("#results");
  if (!(panelQuery instanceof HTMLElement) || !(resultsQuery instanceof HTMLElement)) return;
  const panel = panelQuery;
  const results = resultsQuery;
  const preset = new URLSearchParams(window.location.search).get("email") ?? "";
  panel.append(lookupForm((email) => void show(email), preset));

  async function show(email: string) {
    results.replaceChildren(messageNode("Loading records…"));
    try {
      const payload = await getJson<{ selections: Selection[] }>(
        `/api/selections?email=${encodeURIComponent(email)}`,
      );
      results.replaceChildren();
      if (payload.selections.length === 0) {
        results.append(messageNode("No email-and-ball records for that address."));
        return;
      }
      for (const selection of payload.selections) {
        const card = document.createElement("article");
        card.className = "record";
        const title = document.createElement("h3");
        title.textContent = `${selection.email} → ${selection.label}`;
        const receiptLine = selection.emailRecord
          ? `Receipt “${selection.emailRecord.subject}” — ${selection.emailRecord.sent ? "sent" : "stored, not sent"}.`
          : "No receipt stored for this selection.";
        card.append(
          title,
          messageNode(`Ball status: ${statusWord(selection.ballStatus)}. Purchase: ${purchaseWord(selection.purchaseStatus)}.`),
          messageNode(receiptLine),
        );
        results.append(card);
      }
    } catch (error) {
      results.replaceChildren(messageNode(error instanceof Error ? error.message : "Lookup failed.", true));
    }
  }

  if (preset) void show(preset);
}

function startAdmin(config: Config, initial: Ball[]): void {
  const boardQuery = document.querySelector("#board");
  const panelQuery = document.querySelector("#admin-panel");
  const listQuery = document.querySelector("#admin-list");
  if (
    !(boardQuery instanceof HTMLElement) ||
    !(panelQuery instanceof HTMLElement) ||
    !(listQuery instanceof HTMLElement)
  ) {
    return;
  }
  const board = boardQuery;
  const panel = panelQuery;
  const list = listQuery;
  let balls = initial;
  let chosen: Ball | null = null;
  let token = "";

  const drawBalls = () => {
    paintBoard(board, balls, {
      picking: true,
      activeId: chosen?.id ?? null,
      onPick(ball) {
        chosen = ball;
        drawBalls();
      },
    });
  };

  const form = document.createElement("form");
  form.className = "stack";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.required = true;
  const name = textInput("text", "buyerName");
  const email = textInput("email", "email", true);
  const note = document.createElement("textarea");
  note.maxLength = 200;
  note.placeholder = "Recorded at the club table in the demo.";
  const submit = actionButton("Record offline demo sale");
  submit.type = "submit";
  form.append(
    field("Admin token", tokenInput),
    field("Email", email),
    field("Name (optional)", name),
    field("Note", note),
    submit,
  );
  panel.replaceChildren(messageNode("Pick an open ball, then record it. Shaded balls stay unavailable."), form);
  if (!config.offlineSalesConfigured) {
    panel.prepend(messageNode("Set ADMIN_TOKEN in .dev.vars before recording an offline sale."));
  }
  drawBalls();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void record();
  });

  async function record() {
    if (!chosen) {
      panel.append(messageNode("Choose an open ball first.", true));
      return;
    }
    token = tokenInput.value;
    submit.disabled = true;
    try {
      const result = await postJson<{ purchase: Purchase; email: EmailResult }>(
        "/api/admin/offline-sales",
        {
          ballId: chosen.id,
          email: email.value,
          buyerName: name.value,
          note: note.value,
        },
        token,
      );
      chosen = null;
      balls = await loadBalls();
      renderMarquee(balls);
      drawBalls();
      panel.append(
        messageNode(
          `${result.purchase.ball.label} recorded for ${result.purchase.buyerEmail}. Charged: no. Email sent: ${result.email.sent ? "yes" : "no"}.`,
        ),
      );
      await showSales();
    } catch (error) {
      panel.append(messageNode(error instanceof Error ? error.message : "Could not record that sale.", true));
    } finally {
      submit.disabled = false;
    }
  }

  async function showSales() {
    if (!token) {
      list.replaceChildren(messageNode("Enter the admin token and record a sale to load the list."));
      return;
    }
    try {
      const payload = await getJson<{ purchases: Purchase[] }>("/api/admin/sales", token);
      list.replaceChildren();
      for (const purchase of payload.purchases) {
        const card = document.createElement("article");
        card.className = "record";
        const title = document.createElement("h3");
        title.textContent = `${purchase.ball.label} · ${purchase.buyerEmail}`;
        card.append(
          title,
          messageNode(`${purchaseWord(purchase.status)} · ${paymentWord(purchase.paymentMode)} · charged: no`),
        );
        list.append(card);
      }
    } catch (error) {
      list.replaceChildren(messageNode(error instanceof Error ? error.message : "Could not load sales.", true));
    }
  }

  void showSales();
}

async function boot(): Promise<void> {
  const view = document.body.dataset.view ?? "board";
  try {
    const [config, balls] = await Promise.all([getJson<Config>("/api/config"), loadBalls()]);
    renderMarquee(balls);
    if (view === "board") startBoard(config, balls);
    if (view === "purchases") startPurchases();
    if (view === "selections") startSelections();
    if (view === "admin") startAdmin(config, balls);
  } catch (error) {
    const text = error instanceof Error ? error.message : "Could not load the demo.";
    const slot = document.querySelector("#panel") ?? document.querySelector("#admin-panel");
    if (slot) slot.textContent = text;
  }
}

void boot();
