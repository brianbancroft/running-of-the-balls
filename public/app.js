import { buyBall, checkoutReservation, downloadCsv, getBalls, getConfig, getReservation, getSession, holdReservation, listSales, offlineSale, purchaseForToken, releaseReservation, selectionsFor, voidSale, } from "./api.js";
import { ballColour, ballNumber, customerHoldSummary, marqueeNumbers, money } from "./format.js";
import { readBuyer, readDeadline, readPaused, readPicks, readQty, readReceipt, writeBuyer, writeDeadline, writePaused, writePicks, writeQty, writeReceipt, fieldSeed, } from "./store.js";
function inventoryOf(balls) {
    return new Map(balls.map((ball) => [ball.ballNumber, ball]));
}
function isFree(ball) {
    return ball?.status === "available";
}
function visualFor(n, balls, picks, taken = new Set()) {
    if (taken.has(n))
        return "taken";
    if (picks.includes(n) && balls.get(n)?.status !== "sold")
        return "mine";
    if (!isFree(balls.get(n)))
        return "sold";
    return "available";
}
function stillOurs(n, balls, picks) {
    return picks.includes(n) && balls.get(n)?.status === "selected";
}
let reservationBusy = false;
let holdTimer = 0;
function formatRemain(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function holdClockText() {
    const deadline = readDeadline();
    if (!deadline)
        return "";
    const remain = new Date(deadline).getTime() - Date.now();
    if (remain <= 0)
        return "Held for 0:00. Unpaid balls go back in the pit.";
    return `Held for ${formatRemain(remain)}. Unpaid balls go back in the pit when this runs out.`;
}
function paintHoldClocks() {
    const text = holdClockText();
    for (const node of document.querySelectorAll("[data-hold-clock]")) {
        node.textContent = text;
    }
}
function armHoldClock() {
    window.clearInterval(holdTimer);
    const deadline = readDeadline();
    if (!deadline)
        return;
    const tick = () => {
        paintHoldClocks();
        if (new Date(deadline).getTime() <= Date.now()) {
            window.clearInterval(holdTimer);
            location.reload();
        }
    };
    tick();
    holdTimer = window.setInterval(tick, 1000);
}
function applyReservation(reservation, balls) {
    const picks = reservation.holds
        .filter((hold) => hold.state === "pending_payment")
        .map((hold) => hold.ballNumber);
    writePicks(picks);
    writeDeadline(reservation.session?.status === "open" && picks.length > 0 ? reservation.session.expiresAt : null);
    for (const hold of reservation.holds) {
        if (hold.state !== "pending_payment")
            continue;
        const ball = balls.get(hold.ballNumber);
        if (ball)
            balls.set(hold.ballNumber, { ...ball, status: "selected" });
    }
    armHoldClock();
    return picks;
}
async function reloadInventory(balls) {
    const fresh = inventoryOf(await getBalls());
    balls.clear();
    for (const [key, value] of fresh)
        balls.set(key, value);
}
async function toggleHeld(n, balls, picks) {
    if (reservationBusy)
        return picks;
    const ball = balls.get(n);
    if (!ball)
        return picks;
    const state = visualFor(n, balls, picks);
    if (state === "sold")
        return picks;
    reservationBusy = true;
    try {
        const reservation = state === "mine" ? await releaseReservation(ball.id) : await holdReservation(ball.id);
        if (state === "mine")
            balls.set(n, { ...ball, status: "available" });
        return applyReservation(reservation, balls);
    }
    catch (error) {
        say(error instanceof Error ? error.message : "That ball is not available.");
        await reloadInventory(balls);
        try {
            return applyReservation(await getReservation(), balls);
        }
        catch {
            return readPicks();
        }
    }
    finally {
        reservationBusy = false;
    }
}
async function releaseNumbers(numbers, balls) {
    let picks = readPicks();
    for (const n of numbers) {
        const ball = balls.get(n);
        if (!ball)
            continue;
        const reservation = await releaseReservation(ball.id);
        balls.set(n, { ...ball, status: "available" });
        picks = applyReservation(reservation, balls);
    }
    return picks;
}
function paint(node, n, state, status) {
    const colour = ballColour(n);
    node.className = `ball ${state}`;
    node.style.setProperty("--c", colour.c);
    node.style.setProperty("--hi", colour.hi);
    node.style.setProperty("--lo", colour.lo);
    node.replaceChildren();
    const num = document.createElement("b");
    num.textContent = ballNumber(n);
    node.append(num);
    if (state === "mine") {
        const yours = document.createElement("i");
        yours.className = "yours";
        yours.textContent = "Yours";
        node.append(yours);
    }
    if (node instanceof HTMLButtonElement) {
        const label = state === "mine"
            ? "yours"
            : state === "taken"
                ? "just taken"
                : state === "sold" && status === "selected"
                    ? "held"
                    : state;
        node.setAttribute("aria-label", `Ball ${ballNumber(n)}, ${label}`);
        node.setAttribute("aria-pressed", state === "mine" ? "true" : "false");
        if (state === "sold" || state === "taken")
            node.setAttribute("aria-disabled", "true");
        else
            node.removeAttribute("aria-disabled");
    }
}
function say(text) {
    const live = document.querySelector("#live");
    if (live)
        live.textContent = text;
}
function highestBall(balls) {
    let max = 0;
    for (const n of balls.keys())
        if (n > max)
            max = n;
    return max;
}
function renderMarquee(root, balls, picks, soldAll, pickable) {
    root.replaceChildren();
    const per = 26;
    const rows = 12;
    const sample = marqueeNumbers([...balls.values()], rows * per, fieldSeed());
    let tabStopPlaced = false;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        const row = document.createElement("div");
        row.className = rowIndex % 2 === 0 ? "row" : "row back";
        row.style.setProperty("--dur", `${70 + (rowIndex * 37) % 45}s`);
        row.style.setProperty("--delay", `${-((rowIndex * 17) % 60)}s`);
        row.style.setProperty("--rest", `${-10 - ((rowIndex * 13) % 36)}%`);
        const slice = sample.slice(rowIndex * per, rowIndex * per + per);
        for (let copy = 0; copy < 2; copy += 1) {
            slice.forEach((n, col) => {
                const node = pickable && copy === 0 ? document.createElement("button") : document.createElement("span");
                node.dataset.n = String(n);
                if (node instanceof HTMLButtonElement) {
                    node.type = "button";
                    node.dataset.row = String(rowIndex);
                    node.dataset.col = String(col);
                    node.tabIndex = tabStopPlaced ? -1 : 0;
                    tabStopPlaced = true;
                }
                else if (copy === 1) {
                    node.setAttribute("aria-hidden", "true");
                }
                paint(node, n, soldAll ? "sold" : visualFor(n, balls, picks), balls.get(n)?.status);
                row.append(node);
            });
        }
        root.append(row);
    }
}
function patchMarquee(root, balls, picks) {
    for (const node of root.querySelectorAll("[data-n]")) {
        const n = Number(node.dataset.n);
        paint(node, n, visualFor(n, balls, picks), balls.get(n)?.status);
    }
}
function neighbours(n, balls, picks) {
    const found = [];
    for (const delta of [1, -1, 2, -2, 3, -3]) {
        const candidate = n + delta;
        if (!balls.has(candidate) || picks.includes(candidate))
            continue;
        if (isFree(balls.get(candidate)))
            found.push(candidate);
        if (found.length === 3)
            break;
    }
    return found;
}
function ph(text) {
    const node = document.createElement("span");
    node.className = "ph";
    node.textContent = text;
    return node;
}
async function boot() {
    const page = document.body.dataset.page ?? "home";
    const [config, list] = await Promise.all([getConfig(), getBalls()]);
    const balls = inventoryOf(list);
    if (config.allowBallPicking && (page === "home" || page === "pick" || page === "checkout")) {
        try {
            applyReservation(await getReservation(), balls);
        }
        catch {
            writePicks([]);
            writeDeadline(null);
        }
    }
    const free = [...balls.values()].filter((ball) => ball.status === "available").length;
    const soldOut = free === 0;
    tuneChrome(config, soldOut);
    if (page === "home")
        initHome(config, balls, list.length, free, soldOut);
    if (page === "pick")
        initPick(config, balls, soldOut);
    if (page === "checkout")
        initCheckout(config, balls);
    if (page === "confirmation")
        initConfirmation(config);
    if (page === "purchase")
        await initPurchase();
    if (page === "selections")
        await initSelections();
    if (page === "admin")
        await initAdmin(balls);
}
function tuneChrome(config, soldOut) {
    for (const node of document.querySelectorAll("[data-licence-status]")) {
        node.textContent = config.licenceStatus;
    }
    for (const link of document.querySelectorAll("a[data-rules-link]")) {
        link.href = config.rulesUrl;
    }
    for (const node of document.querySelectorAll("[data-needs='pick']")) {
        node.hidden = !config.allowBallPicking || soldOut;
    }
    for (const node of document.querySelectorAll("[data-hide='soldout']")) {
        node.hidden = soldOut;
    }
    for (const link of document.querySelectorAll("[data-get-ball]")) {
        link.href = config.allowBallPicking ? "/pick" : "/checkout";
        link.hidden = soldOut;
    }
}
function initHome(config, balls, total, free, soldOut) {
    const field = document.querySelector("#field");
    const tilt = document.querySelector("#tilt");
    const legend = document.querySelector("#legend");
    const tray = document.querySelector("#tray");
    const motion = document.querySelector("#motion");
    if (!(field instanceof HTMLElement) || !(tilt instanceof HTMLElement) || !(legend instanceof HTMLElement))
        return;
    const pickable = config.allowBallPicking && !soldOut;
    field.classList.toggle("pickable", pickable);
    field.removeAttribute("aria-hidden");
    if (pickable) {
        tilt.removeAttribute("aria-hidden");
        tilt.setAttribute("role", "group");
        tilt.setAttribute("aria-label", "Balls. Arrow keys move between balls. Enter picks a free ball. Shaded balls are held or sold.");
    }
    else {
        tilt.setAttribute("aria-hidden", "true");
    }
    let picks = readPicks();
    renderMarquee(tilt, balls, picks, soldOut, pickable);
    const paused = readPaused();
    if (paused)
        field.classList.add("paused");
    const setMotion = () => {
        if (!(motion instanceof HTMLButtonElement))
            return;
        const hovering = pickable && field.matches(":hover");
        motion.replaceChildren();
        const label = document.createElement("span");
        label.textContent = field.classList.contains("paused")
            ? "Motion paused"
            : hovering
                ? "Paused while you pick"
                : "Pause motion";
        const tog = document.createElement("span");
        tog.className = field.classList.contains("paused") ? "tog play" : "tog";
        motion.append(label, tog);
        motion.setAttribute("aria-pressed", field.classList.contains("paused") ? "true" : "false");
    };
    setMotion();
    motion?.addEventListener("click", () => {
        field.classList.toggle("paused");
        writePaused(field.classList.contains("paused"));
        setMotion();
    });
    field.addEventListener("mouseenter", setMotion);
    field.addEventListener("mouseleave", setMotion);
    document.addEventListener("visibilitychange", () => {
        field.classList.toggle("paused", document.hidden || readPaused());
    });
    const drawLegend = () => {
        legend.replaceChildren();
        const items = soldOut
            ? [["sold", "Held or sold"]]
            : pickable
                ? [["available", "Available"], ["mine", "Yours"], ["sold", "Held or sold"]]
                : [["available", "Available"], ["sold", "Held or sold"]];
        for (const [state, text] of items) {
            const span = document.createElement("span");
            span.className = "k";
            const ball = document.createElement("span");
            paint(ball, state === "sold" ? 6 : 5, state);
            span.append(ball, text);
            legend.append(span);
        }
    };
    drawLegend();
    const stock = document.querySelector("#stock-line");
    const bar = document.querySelector("#stock-bar");
    const countLabel = total.toLocaleString("en-CA");
    if (stock) {
        stock.replaceChildren();
        const strong = document.createElement("strong");
        strong.className = "tnum";
        strong.textContent = `${free.toLocaleString("en-CA")} of ${countLabel} balls still free`;
        stock.append(strong, " · shaded balls are held or sold");
    }
    const soldLine = document.querySelector("#soldout-stock");
    if (soldLine)
        soldLine.textContent = `All ${countLabel} balls are shaded.`;
    const hero = document.querySelector("#hero-lede");
    if (hero) {
        hero.textContent = `${countLabel} colourful balls, one steep street. Get a numbered ball, then watch it race down High Street — the first balls to the bottom win cash prizes.`;
    }
    if (bar instanceof HTMLElement)
        bar.style.width = `${total === 0 ? 0 : ((total - free) / total) * 100}%`;
    const price = document.querySelector("#unit-price");
    if (price)
        price.textContent = `${money(config.amountCents, config.currency)} a ball`;
    document.querySelector("#card-soldout")?.toggleAttribute("hidden", !soldOut);
    document.querySelector("#card-open")?.toggleAttribute("hidden", soldOut);
    document.querySelector("#pick-controls")?.toggleAttribute("hidden", !pickable);
    document.querySelector("#qty-controls")?.toggleAttribute("hidden", pickable || soldOut);
    const qtyOut = document.querySelector("#qty");
    const qtySum = document.querySelector("#qty-sum");
    const qtyBtn = document.querySelector("#qty-cta");
    const maxQty = Math.max(1, free);
    let qty = Math.min(readQty(), maxQty);
    const drawQty = () => {
        if (qtyOut instanceof HTMLInputElement) {
            qtyOut.value = String(qty);
            qtyOut.max = String(maxQty);
        }
        else if (qtyOut) {
            qtyOut.textContent = String(qty);
        }
        if (qtySum)
            qtySum.textContent = money(qty * config.amountCents, config.currency);
        if (qtyBtn)
            qtyBtn.textContent = qty === 1 ? "Get a ball" : `Get ${qty} balls`;
        writeQty(qty);
    };
    drawQty();
    qtyOut?.addEventListener("change", () => {
        if (!(qtyOut instanceof HTMLInputElement))
            return;
        const next = Number(qtyOut.value);
        qty = Number.isInteger(next) ? Math.min(maxQty, Math.max(1, next)) : 1;
        drawQty();
        say(`${qty} ${qty === 1 ? "ball" : "balls"}.`);
    });
    document.querySelector("#qty-dec")?.addEventListener("click", () => {
        qty = Math.max(1, qty - 1);
        drawQty();
    });
    document.querySelector("#qty-inc")?.addEventListener("click", () => {
        if (free > 0 && qty >= free) {
            say(`Quantity ${qty}. That's every ball still free.`);
            return;
        }
        qty += 1;
        drawQty();
        say(`Quantity ${qty}.`);
    });
    const drawTray = () => {
        if (!(tray instanceof HTMLElement))
            return;
        const show = pickable && picks.length > 0;
        tray.hidden = !show;
        document.querySelector(".hero")?.classList.toggle("tray-open", show);
        if (!show)
            return;
        tray.replaceChildren();
        const label = document.createElement("div");
        label.className = "lbl";
        label.textContent = "Your balls";
        const group = document.createElement("div");
        group.className = "balls";
        for (const n of picks) {
            const wrap = document.createElement("span");
            wrap.style.position = "relative";
            const ball = document.createElement("span");
            paint(ball, n, "mine");
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "x";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `Remove ball ${ballNumber(n)}`);
            remove.addEventListener("click", () => {
                const before = picks.includes(n);
                void (async () => {
                    picks = await toggleHeld(n, balls, picks);
                    patchMarquee(tilt, balls, picks);
                    drawTray();
                    if (before !== picks.includes(n))
                        say(`Ball ${ballNumber(n)} removed. ${picks.length} balls.`);
                })();
            });
            wrap.append(ball, remove);
            group.append(wrap);
        }
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "clear";
        clear.textContent = "Clear";
        clear.addEventListener("click", () => {
            const held = [...picks];
            void (async () => {
                try {
                    picks = await releaseNumbers(held, balls);
                }
                catch (error) {
                    say(error instanceof Error ? error.message : "Those balls could not be released.");
                    picks = readPicks();
                }
                patchMarquee(tilt, balls, picks);
                drawTray();
            })();
        });
        const total = document.createElement("div");
        total.className = "total";
        const strong = document.createElement("strong");
        strong.textContent = money(picks.length * config.amountCents, config.currency);
        const meta = document.createElement("span");
        meta.append(`${picks.length} × `, ph("Placeholder price"));
        const clock = document.createElement("span");
        clock.className = "hold-clock";
        clock.dataset.holdClock = "true";
        clock.textContent = holdClockText();
        total.append(strong, meta, clock);
        const next = document.createElement("a");
        next.className = "btn red";
        next.href = "/checkout";
        next.textContent = "Continue to checkout";
        tray.append(label, group, clear, total, next);
    };
    drawTray();
    tilt.addEventListener("keydown", (event) => {
        if (!pickable)
            return;
        const current = event.target;
        if (!(current instanceof HTMLButtonElement) || current.dataset.row == null || current.dataset.col == null)
            return;
        const row = Number(current.dataset.row);
        const col = Number(current.dataset.col);
        if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
        event.preventDefault();
        let target = null;
        if (event.key === "Home" || event.key === "End") {
            const buttons = [...tilt.querySelectorAll(`button[data-row="${row}"]`)];
            target = event.key === "Home" ? (buttons[0] ?? null) : (buttons[buttons.length - 1] ?? null);
        }
        else {
            const nextRow = event.key === "ArrowDown" ? row + 1 : event.key === "ArrowUp" ? row - 1 : row;
            const nextCol = event.key === "ArrowRight" ? col + 1 : event.key === "ArrowLeft" ? col - 1 : col;
            target = tilt.querySelector(`button[data-row="${nextRow}"][data-col="${nextCol}"]`);
        }
        if (!target || target === current)
            return;
        for (const button of tilt.querySelectorAll("button.ball"))
            button.tabIndex = -1;
        target.tabIndex = 0;
        target.focus();
    });
    field.addEventListener("click", (event) => {
        if (!pickable)
            return;
        const target = event.target instanceof Element ? event.target.closest("[data-n]") : null;
        if (!target?.dataset.n)
            return;
        const n = Number(target.dataset.n);
        const state = visualFor(n, balls, picks);
        if (state === "sold") {
            target.classList.add("press-sold", "shake");
            window.setTimeout(() => target.classList.remove("shake"), 240);
            showBlocked(target, n, balls, picks, () => {
                picks = readPicks();
                patchMarquee(tilt, balls, picks);
                drawTray();
            });
            return;
        }
        const before = picks.includes(n);
        void (async () => {
            picks = await toggleHeld(n, balls, picks);
            patchMarquee(tilt, balls, picks);
            drawTray();
            if (before === picks.includes(n))
                return;
            say(before
                ? `Ball ${ballNumber(n)} removed. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`
                : `Ball ${ballNumber(n)} held. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`);
        })();
    });
}
let dismissBlocked = null;
function showBlocked(anchor, n, balls, picks, onPick) {
    dismissBlocked?.();
    const free = neighbours(n, balls, picks);
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.setAttribute("role", "alert");
    const title = document.createElement("h3");
    const held = balls.get(n)?.status === "selected";
    title.textContent = held ? `Ball ${ballNumber(n)} is held` : `Ball ${ballNumber(n)} is already sold`;
    const copy = document.createElement("p");
    copy.textContent = "Shaded balls belong to someone else, so they can't be picked.";
    pop.append(title, copy);
    const acts = document.createElement("div");
    acts.className = "acts";
    const first = free[0];
    if (free.length > 0) {
        const alts = document.createElement("div");
        alts.className = "alts";
        for (const alt of free) {
            const ball = document.createElement("span");
            paint(ball, alt, "available");
            alts.append(ball);
        }
        pop.append(alts);
        if (first !== undefined) {
            const choose = document.createElement("button");
            choose.type = "button";
            choose.className = "btn red sm";
            choose.textContent = `Pick ${ballNumber(first)}`;
            choose.addEventListener("click", () => {
                const ball = balls.get(first);
                if (!ball)
                    return;
                void (async () => {
                    try {
                        applyReservation(await holdReservation(ball.id), balls);
                        finish();
                        onPick();
                        say(`Ball ${ballNumber(first)} held.`);
                    }
                    catch (error) {
                        say(error instanceof Error ? error.message : "That ball is not available.");
                    }
                })();
            });
            acts.append(choose);
        }
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn ghost sm";
    close.textContent = "Close";
    close.addEventListener("click", () => finish());
    acts.append(close);
    pop.append(acts);
    const rect = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.left = `${Math.max(12, rect.left)}px`;
    pop.style.top = `${rect.bottom + 12}px`;
    pop.style.zIndex = "30";
    document.body.append(pop);
    const onKey = (event) => {
        if (event.key === "Escape")
            finish();
    };
    const onPointer = (event) => {
        if (!(event.target instanceof Node) || pop.contains(event.target) || event.target === anchor)
            return;
        finish();
    };
    const finish = () => {
        pop.remove();
        anchor.classList.remove("press-sold");
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("pointerdown", onPointer);
        if (dismissBlocked === finish)
            dismissBlocked = null;
        if (anchor instanceof HTMLButtonElement)
            anchor.focus();
    };
    dismissBlocked = finish;
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
}
function initPick(config, balls, soldOut) {
    if (!config.allowBallPicking || soldOut) {
        location.href = "/";
        return;
    }
    const grid = document.querySelector("#grid");
    const ranges = document.querySelector("#ranges");
    const side = document.querySelector("#side");
    const found = document.querySelector("#found");
    const search = document.querySelector("#find");
    if (!(grid instanceof HTMLElement) || !(ranges instanceof HTMLElement) || !(side instanceof HTMLElement))
        return;
    let picks = readPicks();
    const highest = highestBall(balls);
    let start = 1;
    let hideSold = false;
    const drawSide = () => {
        side.replaceChildren();
        const heading = document.createElement("h2");
        heading.append("Your balls");
        const count = document.createElement("span");
        count.textContent = `${picks.length} picked`;
        heading.append(count);
        side.append(heading);
        if (picks.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty-slot";
            empty.append(document.createElement("i"), "Pick as many as you like.");
            side.append(empty);
        }
        for (const n of picks) {
            const line = document.createElement("div");
            line.className = "line";
            const ball = document.createElement("span");
            paint(ball, n, "mine");
            const name = document.createElement("div");
            const nm = document.createElement("div");
            nm.className = "nm";
            nm.textContent = `Ball ${ballNumber(n)}`;
            const sub = document.createElement("div");
            sub.className = "sub";
            sub.textContent = "Held until you pay";
            name.append(nm, sub);
            const amt = document.createElement("div");
            amt.className = "amt";
            amt.textContent = money(config.amountCents, config.currency);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "rm";
            remove.textContent = "Remove";
            remove.setAttribute("aria-label", `Remove ball ${ballNumber(n)}`);
            remove.addEventListener("click", () => {
                void (async () => {
                    picks = await toggleHeld(n, balls, picks);
                    draw();
                })();
            });
            line.append(ball, name, amt, remove);
            side.append(line);
        }
        const tot = document.createElement("div");
        tot.className = "tot";
        tot.append(ph("Placeholder price"));
        const strong = document.createElement("strong");
        strong.textContent = money(picks.length * config.amountCents, config.currency);
        tot.append(strong);
        const next = document.createElement("a");
        next.className = "btn red";
        next.href = picks.length ? "/checkout" : "/pick";
        next.textContent = "Continue to checkout";
        if (!picks.length)
            next.setAttribute("aria-disabled", "true");
        const hold = document.createElement("p");
        hold.className = "fine";
        hold.dataset.holdClock = "true";
        hold.textContent = holdClockText() || "The five minutes start when you hold your first ball.";
        side.append(tot, next, hold);
    };
    const draw = () => {
        const blockEnd = Math.min(start + 99, highest);
        ranges.replaceChildren();
        const blocks = Math.max(1, Math.ceil(highest / 100));
        for (let block = 0; block < blocks; block += 1) {
            const from = block * 100 + 1;
            const to = Math.min(from + 99, highest);
            let open = 0;
            for (let n = from; n <= to; n += 1)
                if (isFree(balls.get(n)))
                    open += 1;
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = from === start ? "rg on" : "rg";
            tab.setAttribute("aria-pressed", from === start ? "true" : "false");
            tab.setAttribute("aria-label", `Balls ${ballNumber(from)} to ${ballNumber(to)}, ${open} free`);
            tab.append(`${ballNumber(from)}–${ballNumber(to)}`);
            const small = document.createElement("small");
            small.textContent = `${open} free`;
            tab.append(small);
            tab.addEventListener("click", () => {
                start = from;
                draw();
            });
            ranges.append(tab);
            if (from === start)
                requestAnimationFrame(() => tab.scrollIntoView({ block: "nearest", inline: "nearest" }));
        }
        grid.replaceChildren();
        grid.setAttribute("role", "group");
        grid.setAttribute("aria-label", `Balls ${ballNumber(start)} to ${ballNumber(blockEnd)}`);
        const buttons = [];
        for (let n = start; n <= blockEnd; n += 1) {
            if (!balls.has(n))
                continue;
            const state = visualFor(n, balls, picks);
            if (hideSold && state === "sold")
                continue;
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.n = String(n);
            paint(button, n, state, balls.get(n)?.status);
            button.tabIndex = buttons.length === 0 ? 0 : -1;
            button.addEventListener("click", () => toggle(n, button));
            buttons.push(button);
            grid.append(button);
        }
        grid.onkeydown = (event) => move(event, buttons);
        drawSide();
        const foot = document.querySelector("#range-count");
        if (foot) {
            let open = 0;
            for (let n = start; n <= blockEnd; n += 1)
                if (isFree(balls.get(n)))
                    open += 1;
            foot.textContent = `${ballNumber(start)}–${ballNumber(blockEnd)} · ${open} free`;
        }
    };
    const toggle = (n, button) => {
        const state = visualFor(n, balls, picks);
        if (state === "sold") {
            button.classList.add("press-sold", "shake");
            window.setTimeout(() => button.classList.remove("shake"), 240);
            showBlocked(button, n, balls, picks, () => {
                picks = readPicks();
                draw();
            });
            return;
        }
        const before = picks.includes(n);
        void (async () => {
            picks = await toggleHeld(n, balls, picks);
            draw();
            if (before === picks.includes(n))
                return;
            say(`Ball ${ballNumber(n)} ${before ? "removed" : "held"}. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`);
        })();
    };
    if (search instanceof HTMLInputElement && found) {
        search.addEventListener("input", () => {
            const n = Number(search.value);
            if (!Number.isInteger(n) || !balls.has(n)) {
                found.textContent = search.value.trim()
                    ? "That number isn't in this catalogue."
                    : "Find a ball by its number.";
                return;
            }
            const block = Math.floor((n - 1) / 100) * 100 + 1;
            start = block;
            const status = balls.get(n)?.status;
            const word = status === "selected" ? "held" : status === "sold" ? "sold" : "free";
            const blockEnd = Math.min(block + 99, highest);
            found.textContent = `${ballNumber(n)} is ${word}. It's in ${ballNumber(block)}–${ballNumber(blockEnd)}.`;
            draw();
            grid.querySelector(`[data-n="${n}"]`)?.focus();
        });
    }
    document.querySelector("#hide-sold")?.addEventListener("change", (event) => {
        hideSold = event.target instanceof HTMLInputElement && event.target.checked;
        draw();
    });
    draw();
}
function move(event, buttons) {
    const cols = window.matchMedia("(max-width: 800px)").matches ? 5 : 10;
    const current = buttons.indexOf(document.activeElement);
    if (current < 0)
        return;
    let next = current;
    if (event.key === "ArrowRight")
        next = Math.min(buttons.length - 1, current + 1);
    if (event.key === "ArrowLeft")
        next = Math.max(0, current - 1);
    if (event.key === "ArrowDown")
        next = Math.min(buttons.length - 1, current + cols);
    if (event.key === "ArrowUp")
        next = Math.max(0, current - cols);
    if (event.key === "Home")
        next = current - (current % cols);
    if (event.key === "End")
        next = Math.min(buttons.length - 1, current - (current % cols) + cols - 1);
    if (next === current)
        return;
    event.preventDefault();
    const target = buttons[next];
    if (!target)
        return;
    for (const button of buttons)
        button.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
}
function initCheckout(config, balls) {
    const order = document.querySelector("#order");
    const alert = document.querySelector("#taken");
    const pay = document.querySelector("#pay");
    const name = document.querySelector("#buyer-name");
    const email = document.querySelector("#buyer-email");
    if (!(order instanceof HTMLElement) || !(pay instanceof HTMLButtonElement))
        return;
    if (!(name instanceof HTMLInputElement) || !(email instanceof HTMLInputElement))
        return;
    const buyer = readBuyer();
    name.value = buyer.name;
    email.value = buyer.email;
    let dropped = new Set();
    const amount = document.querySelector("#pay-amount");
    const draw = () => {
        const picks = config.allowBallPicking ? readPicks().filter((n) => !dropped.has(n)) : [];
        const freeCount = [...balls.values()].filter((ball) => isFree(ball)).length;
        const qty = config.allowBallPicking ? picks.length : Math.min(readQty(), freeCount);
        order.replaceChildren();
        if (config.allowBallPicking) {
            for (const n of readPicks()) {
                const line = document.createElement("div");
                const taken = dropped.has(n) || !stillOurs(n, balls, readPicks());
                line.className = taken ? "line taken" : "line";
                const ball = document.createElement("span");
                paint(ball, n, taken ? "taken" : "mine");
                const label = document.createElement("div");
                label.className = "nm";
                label.textContent = `Ball ${ballNumber(n)}`;
                if (taken) {
                    const tag = document.createElement("span");
                    tag.className = "tagx";
                    tag.textContent = "Taken";
                    label.append(tag);
                }
                const amt = document.createElement("div");
                amt.className = "amt";
                amt.textContent = money(config.amountCents, config.currency);
                line.append(ball, label, amt);
                order.append(line);
            }
            if (readPicks().length > 0) {
                const clock = document.createElement("p");
                clock.className = "fine hold-clock";
                clock.dataset.holdClock = "true";
                clock.textContent = holdClockText();
                order.append(clock);
            }
        }
        else {
            const line = document.createElement("div");
            line.className = "line";
            const label = document.createElement("div");
            label.className = "nm";
            label.textContent = qty === 1 ? "Next free ball" : `Next ${qty} free balls`;
            const amt = document.createElement("div");
            amt.className = "amt";
            amt.textContent = money(qty * config.amountCents, config.currency);
            line.append(label, amt);
            order.append(line);
        }
        const kept = config.allowBallPicking
            ? readPicks().filter((n) => !dropped.has(n) && stillOurs(n, balls, readPicks()))
            : [];
        const bill = (config.allowBallPicking ? kept.length : qty) * config.amountCents;
        const total = document.querySelector("#order-total");
        if (total)
            total.textContent = money(bill, config.currency);
        if (amount)
            amount.textContent = `Pay ${money(bill, config.currency)} · test`;
        const blocked = config.allowBallPicking && readPicks().some((n) => dropped.has(n) || !stillOurs(n, balls, readPicks()));
        pay.disabled = blocked || bill === 0 || config.paymentsBlocked;
        pay.classList.toggle("off", pay.disabled);
        if (alert instanceof HTMLElement) {
            const takenNow = readPicks().filter((n) => !stillOurs(n, balls, readPicks()));
            alert.hidden = takenNow.length === 0;
            if (takenNow.length && takenNow[0] !== undefined) {
                const n = takenNow[0];
                const alts = neighbours(n, balls, readPicks());
                alert.replaceChildren();
                const title = document.createElement("h3");
                const expired = balls.get(n)?.status === "available";
                title.textContent = expired
                    ? `Ball ${ballNumber(n)} went back in the pit`
                    : `Ball ${ballNumber(n)} was just taken`;
                const copy = document.createElement("p");
                copy.textContent = expired
                    ? "The five minutes ran out before checkout. Nothing was charged."
                    : "Someone else bought it while you were checking out. You haven't been charged for anything.";
                alert.append(title, copy);
                if (alts.length > 0) {
                    const nearby = document.createElement("div");
                    nearby.className = "alts";
                    for (const alt of alts) {
                        const ball = document.createElement("span");
                        paint(ball, alt, "available");
                        nearby.append(ball);
                    }
                    alert.append(nearby);
                }
                const actions = document.createElement("div");
                actions.className = "acts";
                const swapTarget = alts[0];
                if (swapTarget !== undefined) {
                    const swap = document.createElement("button");
                    swap.type = "button";
                    swap.className = "btn red sm";
                    swap.textContent = `Swap for ${ballNumber(swapTarget)}`;
                    swap.addEventListener("click", () => {
                        const ball = balls.get(swapTarget);
                        if (!ball)
                            return;
                        void (async () => {
                            try {
                                applyReservation(await holdReservation(ball.id), balls);
                                dropped = new Set();
                                draw();
                            }
                            catch (error) {
                                say(error instanceof Error ? error.message : "That ball is not available.");
                            }
                        })();
                    });
                    actions.append(swap);
                }
                const another = document.createElement("a");
                another.className = "btn ghost sm";
                another.href = "/pick";
                another.textContent = "Pick a different ball";
                actions.append(another);
                if (kept.length > 0) {
                    const keep = document.createElement("button");
                    keep.type = "button";
                    keep.className = "btn ghost sm";
                    keep.textContent = `Continue with ${kept.length} ${kept.length === 1 ? "ball" : "balls"}`;
                    keep.addEventListener("click", () => {
                        dropped = new Set(takenNow);
                        writePicks(kept);
                        draw();
                    });
                    actions.append(keep);
                }
                alert.append(actions);
            }
        }
        const payNote = document.querySelector("#pay-note");
        if (payNote instanceof HTMLElement)
            payNote.hidden = !blocked;
    };
    draw();
    const attest = document.querySelector("#attest");
    const attestNote = document.querySelector("#attest-note");
    if (attest instanceof HTMLInputElement) {
        attest.addEventListener("change", () => {
            if (attest.checked && attestNote instanceof HTMLElement)
                attestNote.hidden = true;
        });
    }
    pay.addEventListener("click", () => {
        void submitCheckout(config, name.value, email.value, pay);
    });
}
async function submitCheckout(config, name, email, pay) {
    const attest = document.querySelector("#attest");
    const attestNote = document.querySelector("#attest-note");
    if (!(attest instanceof HTMLInputElement) || !attest.checked) {
        const message = "Confirm you are 19 or older and physically in British Columbia.";
        if (attestNote instanceof HTMLElement) {
            attestNote.hidden = false;
            attestNote.textContent = message;
        }
        say(message);
        return;
    }
    if (attestNote instanceof HTMLElement)
        attestNote.hidden = true;
    pay.disabled = true;
    writeBuyer(name, email);
    const recorded = [];
    try {
        if (config.allowBallPicking) {
            const reservation = await getReservation();
            const wanted = new Set(readPicks());
            const holds = reservation.holds.filter((hold) => hold.state === "pending_payment" && wanted.has(hold.ballNumber));
            if (holds.length === 0 || holds.length !== wanted.size) {
                pay.disabled = false;
                location.reload();
                return;
            }
            const result = await checkoutReservation({
                email,
                buyerName: name,
                ballIds: holds.map((hold) => hold.ballId),
                attestAge19: true,
                attestInBc: true,
            });
            for (const item of result.purchases) {
                recorded.push({
                    number: item.purchase.ball.ballNumber,
                    status: "recorded",
                    reference: item.purchase.stripeTestReference,
                    receiptToken: item.purchase.receiptToken,
                });
            }
            writePicks([]);
            writeDeadline(null);
        }
        else {
            const fresh = inventoryOf(await getBalls());
            const freeCount = [...fresh.values()].filter((ball) => isFree(ball)).length;
            const qty = Math.min(readQty(), freeCount);
            for (let index = 0; index < qty; index += 1) {
                const result = await buyBall({
                    email,
                    buyerName: name,
                    attestAge19: true,
                    attestInBc: true,
                });
                recorded.push({
                    number: result.purchase.ball.ballNumber,
                    status: "recorded",
                    reference: result.purchase.stripeTestReference,
                    receiptToken: result.purchase.receiptToken,
                });
            }
        }
        writeReceipt({
            email,
            name,
            balls: recorded,
            amountCents: recorded.length * config.amountCents,
            currency: config.currency,
            charged: false,
        });
        location.href = "/confirmation";
    }
    catch (error) {
        if (recorded.length > 0) {
            writePicks(readPicks().filter((n) => !recorded.some((ball) => ball.number === n)));
            writeReceipt({
                email,
                name,
                balls: recorded,
                amountCents: recorded.length * config.amountCents,
                currency: config.currency,
                charged: false,
                incomplete: true,
            });
            location.href = "/confirmation";
            return;
        }
        pay.disabled = false;
        say(error instanceof Error ? error.message : "The test payment did not finish.");
    }
}
function initConfirmation(config) {
    const host = document.querySelector("#confirm");
    if (!(host instanceof HTMLElement))
        return;
    const receipt = readReceipt();
    host.replaceChildren();
    if (!receipt || receipt.balls.length === 0) {
        host.append("No test receipt in this session yet.");
        return;
    }
    const eye = document.createElement("div");
    eye.className = "eyebrow";
    eye.textContent = "Test payment complete";
    const title = document.createElement("h1");
    title.textContent = "You're in the race!";
    const lede = document.createElement("p");
    lede.className = "lede";
    const numbers = receipt.balls.map((ball) => ballNumber(ball.number)).join(", ");
    lede.textContent = receipt.incomplete
        ? `These balls were recorded: ${numbers}. The rest of that checkout did not finish. Nothing was charged.`
        : `Balls ${numbers} are yours. On race day they'll tumble down High Street with the rest of the field.`;
    const big = document.createElement("div");
    big.className = "big";
    for (const ball of receipt.balls) {
        const node = document.createElement("span");
        paint(node, ball.number, "mine");
        big.append(node);
    }
    const actions = document.createElement("div");
    actions.className = "ctas";
    actions.style.justifyContent = "center";
    const again = document.createElement("a");
    again.className = "btn red";
    again.href = config.allowBallPicking ? "/pick" : "/";
    again.textContent = "Get another ball";
    const back = document.createElement("a");
    back.className = "btn ghost";
    back.href = "/";
    back.textContent = "Back to the race";
    actions.append(again, back);
    const table = document.createElement("div");
    table.className = "receipt";
    const head = document.createElement("div");
    head.className = "head";
    head.append(ph("Test"), " Test receipt — no money was charged");
    table.append(head);
    const rows = [
        ["Amount", money(receipt.amountCents, receipt.currency)],
        ["Paid with", "Stripe test placeholder ···· 4242"],
        ["Reference", receipt.balls[0]?.reference ?? "DEMO"],
        ["Race day", "High Street, Ladysmith, BC · date TBA"],
    ];
    for (const [label, value] of rows) {
        const row = document.createElement("div");
        row.className = "r";
        const span = document.createElement("span");
        span.textContent = label;
        const strong = document.createElement("strong");
        strong.textContent = value;
        strong.append(" ", ph("Placeholder"));
        row.append(span, strong);
        table.append(row);
    }
    const next = document.createElement("div");
    next.className = "next";
    const steps = [
        "Save or screenshot your numbers so you know which balls to cheer for.",
        "A confirmation email isn't sent while this demo is in dry run.",
        "Winners are the first balls to reach the bottom. Prizes will be posted before race day.",
    ];
    steps.forEach((text, index) => {
        const row = document.createElement("div");
        const b = document.createElement("b");
        b.textContent = String(index + 1);
        row.append(b, document.createTextNode(text));
        if (index === 1)
            row.append(" ", ph("Email TBC"));
        next.append(row);
    });
    const links = document.createElement("div");
    links.className = "fine";
    const heading = document.createElement("p");
    heading.textContent = "Save the receipt link for each ball. It opens that purchase only.";
    const list = document.createElement("ul");
    for (const ball of receipt.balls) {
        if (!ball.receiptToken)
            continue;
        const item = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.href = `/purchase?token=${encodeURIComponent(ball.receiptToken)}`;
        anchor.textContent = `Receipt for ball ${ballNumber(ball.number)}`;
        item.append(anchor);
        list.append(item);
    }
    links.append(heading, list);
    host.append(eye, title, lede, big, actions, table, next, links);
}
function authMessage(code) {
    if (code === "failed")
        return " Google sign-in did not finish.";
    if (code === "unavailable")
        return " Google sign-in is unavailable right now.";
    if (code === "unverified")
        return " That Google account has no verified email.";
    return "";
}
async function readSession() {
    try {
        return await getSession();
    }
    catch {
        return null;
    }
}
function tokenFromInput(value) {
    const trimmed = value.trim();
    try {
        const url = new URL(trimmed, location.origin);
        const token = url.searchParams.get("token") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
        if (token)
            return token.trim().toLowerCase();
    }
    catch {
        // A bare token is not a URL.
    }
    return trimmed.toLowerCase();
}
function appendPurchase(results, purchase) {
    const card = document.createElement("article");
    card.className = "record";
    const title = document.createElement("h3");
    title.textContent = `Ball ${ballNumber(purchase.ball.ballNumber)}`;
    const status = document.createElement("p");
    status.textContent =
        purchase.status === "voided"
            ? `Voided. This ball is back in the pit. ${purchase.paymentMode}. Charged: no.`
            : `${purchase.status} · ${purchase.paymentMode} · charged: no`;
    card.append(title, status);
    if (purchase.status === "voided" && purchase.void?.reason) {
        const why = document.createElement("p");
        why.textContent = purchase.void.reason;
        card.append(why);
    }
    if (purchase.buyerName) {
        const who = document.createElement("p");
        who.textContent = purchase.buyerName;
        card.append(who);
    }
    const attested = document.createElement("p");
    attested.textContent =
        purchase.attestation.age19 && purchase.attestation.inBc
            ? `Attested: ${purchase.attestation.text ?? "19 or older and physically in British Columbia."}`
            : "No age and location attestation is stored for this demo fixture.";
    card.append(attested);
    const receipt = document.createElement("p");
    receipt.textContent = purchase.emailRecord
        ? `Receipt “${purchase.emailRecord.subject}” — ${purchase.emailRecord.sent ? "sent" : "stored, not sent"}.`
        : "No receipt stored for this row yet.";
    card.append(receipt);
    if (purchase.emailRecord?.text) {
        const body = document.createElement("pre");
        body.className = "receipt-text";
        body.textContent = purchase.emailRecord.text;
        card.append(body);
    }
    results.append(card);
}
function renderCustomerBalls(host, reservation) {
    const summary = customerHoldSummary(reservation);
    host.replaceChildren();
    const show = summary.confirmed.length > 0 || summary.pending.length > 0;
    host.hidden = !show;
    if (!show) {
        writeDeadline(null);
        return;
    }
    if (summary.confirmed.length > 0) {
        const title = document.createElement("div");
        title.className = "eyebrow";
        title.textContent = "Confirmed";
        host.append(title);
        for (const ball of summary.confirmed) {
            const card = document.createElement("article");
            card.className = "record";
            const heading = document.createElement("h3");
            heading.textContent = `Ball ${ballNumber(ball.ballNumber)}`;
            const detail = document.createElement("p");
            detail.textContent = "Confirmed. This ball is yours.";
            const link = document.createElement("a");
            link.href = `/purchase?token=${encodeURIComponent(ball.receiptToken)}`;
            link.textContent = `Receipt for ball ${ballNumber(ball.ballNumber)}`;
            card.append(heading, detail, link);
            host.append(card);
        }
    }
    if (summary.pending.length === 0) {
        writeDeadline(null);
        return;
    }
    writeDeadline(reservation.session?.expiresAt ?? null);
    const title = document.createElement("div");
    title.className = "eyebrow";
    title.textContent = "Held for payment";
    const clock = document.createElement("p");
    clock.className = "hold-clock";
    clock.dataset.holdClock = "true";
    clock.textContent = holdClockText();
    host.append(title, clock);
    for (const hold of summary.pending) {
        const card = document.createElement("article");
        card.className = "record";
        const heading = document.createElement("h3");
        heading.textContent = `Ball ${ballNumber(hold.ballNumber)}`;
        const detail = document.createElement("p");
        detail.textContent = "Held. Not confirmed until payment.";
        card.append(heading, detail);
        host.append(card);
    }
    armHoldClock();
}
async function initPurchase() {
    const form = document.querySelector("#lookup");
    const results = document.querySelector("#results");
    const yours = document.querySelector("#yours");
    if (yours instanceof HTMLElement) {
        try {
            renderCustomerBalls(yours, await getReservation());
        }
        catch {
            yours.hidden = true;
        }
    }
    if (!(form instanceof HTMLFormElement) || !(results instanceof HTMLElement))
        return;
    const input = form.querySelector("input");
    const showToken = async (token) => {
        results.replaceChildren("Loading receipt…");
        try {
            const payload = await purchaseForToken(token);
            results.replaceChildren();
            appendPurchase(results, payload.purchase);
        }
        catch (error) {
            results.textContent = error instanceof Error ? error.message : "That receipt link did not open.";
        }
    };
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input instanceof HTMLInputElement)
            void showToken(tokenFromInput(input.value));
    });
    const fromQuery = new URLSearchParams(location.search).get("token");
    if (fromQuery && input instanceof HTMLInputElement)
        input.value = fromQuery;
    if (fromQuery) {
        void showToken(fromQuery);
        return;
    }
    const saved = readReceipt()?.balls.map((ball) => ball.receiptToken).filter((token) => token.length > 0) ?? [];
    if (saved.length === 0)
        return;
    results.replaceChildren();
    for (const token of saved) {
        try {
            const payload = await purchaseForToken(token);
            appendPurchase(results, payload.purchase);
        }
        catch (error) {
            const note = document.createElement("p");
            note.textContent = error instanceof Error ? error.message : "That receipt link did not open.";
            results.append(note);
        }
    }
}
async function initSelections() {
    const form = document.querySelector("#lookup");
    const results = document.querySelector("#results");
    const gate = document.querySelector("#record-gate");
    const gateCopy = document.querySelector("#record-gate-copy");
    const google = document.querySelector("#record-google");
    const signOut = document.querySelector("#record-signout");
    const tokenInput = document.querySelector("#admin-token");
    const emailInput = document.querySelector("#email");
    if (!(form instanceof HTMLFormElement) || !(results instanceof HTMLElement))
        return;
    if (!(gate instanceof HTMLElement) || !(gateCopy instanceof HTMLElement))
        return;
    if (!(google instanceof HTMLAnchorElement) || !(signOut instanceof HTMLButtonElement))
        return;
    if (!(tokenInput instanceof HTMLInputElement) || !(emailInput instanceof HTMLInputElement))
        return;
    const session = await readSession();
    const notice = authMessage(new URLSearchParams(location.search).get("auth"));
    gate.hidden = false;
    signOut.addEventListener("click", () => {
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => {
            location.href = "/selections";
        });
    });
    let ready = false;
    if (!session?.googleSignIn) {
        gateCopy.textContent = `Email and ball records are for a club admin. Google sign-in is not set up, so use an admin token.${notice}`;
        google.hidden = true;
        signOut.hidden = true;
        tokenInput.required = true;
        ready = true;
    }
    else if (!session.signedIn) {
        gateCopy.textContent = `Sign in with Google, or use an admin token, to open email and ball records.${notice}`;
        google.hidden = false;
        signOut.hidden = true;
        tokenInput.required = true;
        ready = true;
    }
    else if (!session.admin) {
        gateCopy.textContent = `Signed in as ${session.email}. This Google account is not an admin.`;
        google.hidden = true;
        signOut.hidden = false;
        form.hidden = true;
        return;
    }
    else {
        gateCopy.textContent = `Signed in as ${session.email}. This account can read stored email and ball records.`;
        google.hidden = true;
        signOut.hidden = false;
        tokenInput.required = false;
        tokenInput.value = "";
        tokenInput.closest("details")?.setAttribute("hidden", "");
        ready = true;
    }
    if (!ready)
        return;
    form.hidden = false;
    const show = async (email) => {
        results.replaceChildren("Loading records…");
        try {
            const payload = await selectionsFor(email, tokenInput.value);
            results.replaceChildren();
            if (payload.selections.length === 0) {
                results.textContent = "No email-and-ball records for that address.";
                return;
            }
            for (const selection of payload.selections) {
                const card = document.createElement("article");
                card.className = "record";
                const title = document.createElement("h3");
                title.textContent = `${selection.email} → Ball ${ballNumber(selection.ballNumber)}`;
                const detail = document.createElement("p");
                detail.textContent =
                    selection.purchaseStatus === "voided"
                        ? `Purchase voided. The record is kept and the ball is back in the pit. The ball is ${selection.ballStatus} now.${selection.voidReason ? ` ${selection.voidReason}` : ""}`
                        : `Ball ${selection.ballStatus}. Purchase ${selection.purchaseStatus}.`;
                const receipt = document.createElement("p");
                receipt.textContent = selection.emailRecord
                    ? `Receipt “${selection.emailRecord.subject}” — ${selection.emailRecord.sent ? "sent" : "stored, not sent"}.`
                    : "No receipt stored for this selection.";
                card.append(title, detail, receipt);
                if (selection.emailRecord?.text) {
                    const body = document.createElement("pre");
                    body.className = "receipt-text";
                    body.textContent = selection.emailRecord.text;
                    card.append(body);
                }
                results.append(card);
            }
        }
        catch (error) {
            results.textContent = error instanceof Error ? error.message : "Lookup failed.";
        }
    };
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void show(emailInput.value.trim());
    });
}
async function initAdmin(balls) {
    const form = document.querySelector("#admin-form");
    const note = document.querySelector("#admin-status");
    const pick = document.querySelector("#admin-ball");
    const gate = document.querySelector("#admin-gate");
    const gateCopy = document.querySelector("#admin-gate-copy");
    const google = document.querySelector("#admin-google");
    const signOut = document.querySelector("#admin-signout");
    const tokenFallback = document.querySelector("#admin-token-fallback");
    if (!(form instanceof HTMLFormElement) || !(note instanceof HTMLElement) || !(pick instanceof HTMLInputElement))
        return;
    if (!(gate instanceof HTMLElement) || !(gateCopy instanceof HTMLElement))
        return;
    if (!(google instanceof HTMLAnchorElement) || !(signOut instanceof HTMLButtonElement))
        return;
    if (!(tokenFallback instanceof HTMLDetailsElement))
        return;
    const tokenInput = form.querySelector("input[name='token']");
    const correct = document.querySelector("#admin-correct");
    const exports = document.querySelector("#admin-export");
    const voidForm = document.querySelector("#void-form");
    const voidStatus = document.querySelector("#void-status");
    const sales = document.querySelector("#admin-sales");
    const exportStatus = document.querySelector("#export-status");
    if (!(tokenInput instanceof HTMLInputElement))
        return;
    if (!(correct instanceof HTMLElement) || !(exports instanceof HTMLElement))
        return;
    if (!(voidForm instanceof HTMLFormElement) || !(voidStatus instanceof HTMLElement))
        return;
    if (!(sales instanceof HTMLElement) || !(exportStatus instanceof HTMLElement))
        return;
    const session = await readSession();
    const notice = authMessage(new URLSearchParams(location.search).get("auth"));
    gate.hidden = false;
    signOut.addEventListener("click", () => {
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => {
            location.href = "/admin";
        });
    });
    const summary = tokenFallback.querySelector("summary");
    if (!session?.googleSignIn) {
        gateCopy.textContent = `Google sign-in is not set up, so this page still accepts an admin token.${notice}`;
        google.hidden = true;
        signOut.hidden = true;
        tokenFallback.hidden = false;
        tokenFallback.open = true;
        tokenInput.required = true;
        if (summary)
            summary.textContent = "Admin token";
    }
    else if (!session.signedIn) {
        gateCopy.textContent = `Sign in with Google to record or void a sale and download records. A token still works if you have one.${notice}`;
        google.hidden = false;
        signOut.hidden = true;
        tokenInput.required = true;
    }
    else if (!session.admin) {
        gateCopy.textContent = `Signed in as ${session.email}. This Google account is not an admin.`;
        google.hidden = true;
        signOut.hidden = false;
        form.hidden = true;
        return;
    }
    else {
        gateCopy.textContent = `Signed in as ${session.email}. This account can record a sale, void one, and download the records.`;
        google.hidden = true;
        signOut.hidden = false;
        tokenFallback.hidden = true;
        tokenInput.required = false;
        tokenInput.value = "";
    }
    correct.hidden = false;
    exports.hidden = false;
    const loadSales = () => {
        sales.replaceChildren("Loading recent sales…");
        void listSales(tokenInput.value)
            .then((payload) => {
            sales.replaceChildren();
            if (payload.purchases.length === 0) {
                sales.textContent = "No sales recorded yet.";
                return;
            }
            for (const purchase of payload.purchases) {
                const row = document.createElement("article");
                const summary = document.createElement("p");
                summary.textContent = `Ball ${ballNumber(purchase.ball.ballNumber)} · ${purchase.buyerEmail} · ${purchase.paymentMode} · ${purchase.status}`;
                const id = document.createElement("code");
                id.textContent = purchase.id;
                row.append(summary, id);
                if (purchase.status === "voided") {
                    const why = document.createElement("p");
                    why.className = "fine";
                    why.textContent = purchase.void?.reason ? `Voided. ${purchase.void.reason}` : "Voided. The ball is back in the pit.";
                    row.append(why);
                }
                else {
                    const use = document.createElement("button");
                    use.type = "button";
                    use.className = "btn ghost sm";
                    use.textContent = "Use this id";
                    use.addEventListener("click", () => {
                        const idInput = voidForm.querySelector("#void-id");
                        const reasonInput = voidForm.querySelector("#void-reason");
                        if (idInput instanceof HTMLInputElement)
                            idInput.value = purchase.id;
                        if (reasonInput instanceof HTMLTextAreaElement)
                            reasonInput.focus();
                    });
                    row.append(use);
                }
                sales.append(row);
            }
        })
            .catch((error) => {
            sales.textContent = error instanceof Error ? error.message : "Recent sales could not be loaded.";
        });
    };
    if (session?.admin || tokenInput.value.trim())
        loadSales();
    else
        sales.textContent = "Enter the admin token to see recent sales.";
    tokenInput.addEventListener("change", () => {
        if (tokenInput.value.trim())
            loadSales();
    });
    voidForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(voidForm);
        const purchaseId = String(data.get("purchaseId") ?? "").trim();
        const reason = String(data.get("reason") ?? "").trim();
        if (!purchaseId || !reason) {
            voidStatus.textContent = "A purchase id and a reason are required.";
            return;
        }
        voidStatus.textContent = "Voiding…";
        void voidSale(purchaseId, reason, tokenInput.value)
            .then((result) => {
            voidStatus.textContent = `Ball ${ballNumber(result.purchase.ball.ballNumber)} is back in the pit. The purchase is voided, not deleted.`;
            const ball = balls.get(result.purchase.ball.ballNumber);
            if (ball)
                ball.status = "available";
            voidForm.reset();
            loadSales();
        })
            .catch((error) => {
            voidStatus.textContent = error instanceof Error ? error.message : "Could not void that sale.";
        });
    });
    exports.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("[data-export]") : null;
        const filename = button?.dataset.export;
        if (!filename)
            return;
        exportStatus.textContent = "Preparing the download…";
        void downloadCsv(filename, tokenInput.value)
            .then(() => {
            exportStatus.textContent = `${filename} downloaded.`;
        })
            .catch((error) => {
            exportStatus.textContent = error instanceof Error ? error.message : "Download failed.";
        });
    });
    const describe = () => {
        const n = Number(pick.value);
        const ball = balls.get(n);
        if (!ball) {
            note.textContent = "Enter a ball number that exists in this demo.";
            return;
        }
        note.textContent = ball.status === "available"
            ? `Ball ${ballNumber(n)} is free. Recording it locks the ball.`
            : `Ball ${ballNumber(n)} is ${ball.status}. The sale will be refused.`;
    };
    pick.addEventListener("input", describe);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const token = String(data.get("token") ?? "");
        const email = String(data.get("email") ?? "");
        const buyerName = String(data.get("name") ?? "");
        const ballId = balls.get(Number(pick.value))?.id;
        if (!ballId) {
            note.textContent = "Choose a ball number first.";
            return;
        }
        const attested = data.get("attest") === "yes";
        if (!attested) {
            note.textContent = "Confirm the buyer is 19 or older and physically in British Columbia.";
            return;
        }
        void offlineSale({
            email,
            buyerName,
            ballId,
            note: String(data.get("note") ?? ""),
            attestAge19: true,
            attestInBc: true,
        }, token)
            .then((result) => {
            note.textContent = `Ball ${ballNumber(result.purchase.ball.ballNumber)} recorded for ${result.purchase.buyerEmail}. Charged: no. Email sent: ${result.email.sent ? "yes" : "no"}.`;
            const ball = balls.get(result.purchase.ball.ballNumber);
            if (ball)
                ball.status = "sold";
            loadSales();
        })
            .catch((error) => {
            note.textContent = error instanceof Error ? error.message : "Could not record that sale.";
        });
    });
}
void boot();
