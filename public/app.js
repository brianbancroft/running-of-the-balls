import { buyBall, getBalls, getConfig, offlineSale, purchasesFor, selectionsFor, } from "./api.js";
import { ballColour, ballNumber, money } from "./format.js";
import { readBuyer, readPaused, readPicks, readQty, readReceipt, writeBuyer, writePaused, writePicks, writeQty, writeReceipt, fieldSeed, } from "./store.js";
function inventoryOf(balls) {
    return new Map(balls.map((ball) => [ball.ballNumber, ball]));
}
function isFree(ball) {
    return ball?.status === "available";
}
function visualFor(n, balls, picks, taken = new Set()) {
    if (taken.has(n))
        return "taken";
    if (!isFree(balls.get(n)))
        return "sold";
    if (picks.includes(n))
        return "mine";
    return "available";
}
function paint(node, n, state) {
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
        const label = state === "mine" ? "yours" : state === "taken" ? "just taken" : state;
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
function rng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function shuffle(max, seed) {
    const items = Array.from({ length: max }, (_, index) => index + 1);
    const random = rng(seed);
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        const left = items[index];
        const right = items[swap];
        if (left === undefined || right === undefined)
            continue;
        items[index] = right;
        items[swap] = left;
    }
    return items;
}
function renderMarquee(root, balls, picks, max, soldAll) {
    root.replaceChildren();
    const sample = shuffle(max, fieldSeed());
    const per = 26;
    const rows = 12;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        const row = document.createElement("div");
        row.className = rowIndex % 2 === 0 ? "row" : "row back";
        row.style.setProperty("--dur", `${70 + (rowIndex * 37) % 45}s`);
        row.style.setProperty("--delay", `${-((rowIndex * 17) % 60)}s`);
        row.style.setProperty("--rest", `${-10 - ((rowIndex * 13) % 36)}%`);
        const slice = sample.slice(rowIndex * per, rowIndex * per + per);
        for (let copy = 0; copy < 2; copy += 1) {
            for (const n of slice) {
                const span = document.createElement("span");
                span.dataset.n = String(n);
                paint(span, n, soldAll ? "sold" : visualFor(n, balls, picks));
                row.append(span);
            }
        }
        root.append(row);
    }
}
function patchMarquee(root, balls, picks) {
    for (const node of root.querySelectorAll("[data-n]")) {
        const n = Number(node.dataset.n);
        paint(node, n, visualFor(n, balls, picks));
    }
}
function neighbours(n, balls, picks) {
    const found = [];
    for (const delta of [1, -1, 2, -2, 3, -3]) {
        const candidate = n + delta;
        if (candidate < 1 || candidate > 1000 || picks.includes(candidate))
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
    const free = list.filter((ball) => ball.status === "available").length;
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
        initPurchase();
    if (page === "selections")
        initSelections();
    if (page === "admin")
        initAdmin(balls);
}
function tuneChrome(config, soldOut) {
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
    if (!pickable)
        field.setAttribute("aria-hidden", "true");
    else
        field.removeAttribute("aria-hidden");
    let picks = readPicks();
    renderMarquee(tilt, balls, picks, total, soldOut);
    const paused = readPaused();
    if (paused)
        field.classList.add("paused");
    const setMotion = () => {
        if (!(motion instanceof HTMLButtonElement))
            return;
        const hovering = pickable && field.matches(":hover");
        motion.innerHTML = "";
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
            ? [["sold", "Sold"]]
            : pickable
                ? [["available", "Available"], ["mine", "Yours"], ["sold", "Sold"]]
                : [["available", "Available"], ["sold", "Sold"]];
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
    if (stock) {
        stock.replaceChildren();
        const strong = document.createElement("strong");
        strong.className = "tnum";
        strong.textContent = `${free} of ${total} balls still free`;
        stock.append(strong, " · shaded balls are already sold ", ph("Placeholder count"));
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
    let qty = readQty();
    const drawQty = () => {
        if (qtyOut)
            qtyOut.textContent = String(qty);
        if (qtySum)
            qtySum.textContent = money(qty * config.amountCents, config.currency);
        if (qtyBtn)
            qtyBtn.textContent = qty === 1 ? "Get a ball" : `Get ${qty} balls`;
        writeQty(qty);
    };
    drawQty();
    document.querySelector("#qty-dec")?.addEventListener("click", () => {
        qty = Math.max(1, qty - 1);
        drawQty();
    });
    document.querySelector("#qty-inc")?.addEventListener("click", () => {
        qty = Math.min(99, qty + 1);
        drawQty();
        say(`Quantity ${qty}. Limit is still to be confirmed.`);
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
                picks = picks.filter((pick) => pick !== n);
                writePicks(picks);
                patchMarquee(tilt, balls, picks);
                drawTray();
                say(`Ball ${ballNumber(n)} removed. ${picks.length} balls.`);
            });
            wrap.append(ball, remove);
            group.append(wrap);
        }
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "clear";
        clear.textContent = "Clear";
        clear.addEventListener("click", () => {
            picks = [];
            writePicks(picks);
            patchMarquee(tilt, balls, picks);
            drawTray();
        });
        const total = document.createElement("div");
        total.className = "total";
        const strong = document.createElement("strong");
        strong.textContent = money(picks.length * config.amountCents, config.currency);
        const meta = document.createElement("span");
        meta.append(`${picks.length} × `, ph("Placeholder price"));
        total.append(strong, meta);
        const next = document.createElement("a");
        next.className = "btn red";
        next.href = "/checkout";
        next.textContent = "Continue to checkout";
        tray.append(label, group, clear, total, next);
    };
    drawTray();
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
        picks = state === "mine" ? picks.filter((pick) => pick !== n) : [...picks, n];
        writePicks(picks);
        patchMarquee(tilt, balls, picks);
        drawTray();
        say(state === "mine"
            ? `Ball ${ballNumber(n)} removed. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`
            : `Ball ${ballNumber(n)} added. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`);
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
    title.textContent = `Ball ${ballNumber(n)} is already sold`;
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
                writePicks([...new Set([...readPicks().filter((pick) => pick !== n), first])]);
                finish();
                onPick();
                say(`Ball ${ballNumber(first)} added.`);
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
    let start = 301;
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
            empty.append(document.createElement("i"), "Pick as many as you like ", ph("Limit TBC"));
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
            sub.textContent = "Yours until checkout";
            name.append(nm, sub);
            const amt = document.createElement("div");
            amt.className = "amt";
            amt.textContent = money(config.amountCents, config.currency);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "rm";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                picks = picks.filter((pick) => pick !== n);
                writePicks(picks);
                draw();
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
        hold.append("Picks aren't held until you pay. ", ph("Hold rule TBC"));
        side.append(tot, next, hold);
    };
    const draw = () => {
        ranges.replaceChildren();
        for (let block = 0; block < 10; block += 1) {
            const from = block * 100 + 1;
            const to = from + 99;
            let open = 0;
            for (let n = from; n <= to; n += 1)
                if (isFree(balls.get(n)))
                    open += 1;
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = from === start ? "rg on" : "rg";
            tab.append(`${ballNumber(from)}–${to === 1000 ? "1000" : ballNumber(to)}`);
            const small = document.createElement("small");
            small.textContent = `${open} free`;
            tab.append(small);
            tab.addEventListener("click", () => {
                start = from;
                draw();
            });
            ranges.append(tab);
        }
        grid.replaceChildren();
        const buttons = [];
        for (let n = start; n < start + 100; n += 1) {
            const state = visualFor(n, balls, picks);
            if (hideSold && state === "sold")
                continue;
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.n = String(n);
            paint(button, n, state);
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
            for (let n = start; n < start + 100; n += 1)
                if (isFree(balls.get(n)))
                    open += 1;
            foot.textContent = `${ballNumber(start)}–${start + 99} · ${open} free`;
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
        picks = state === "mine" ? picks.filter((pick) => pick !== n) : [...picks, n];
        writePicks(picks);
        draw();
        say(`Ball ${ballNumber(n)} ${state === "mine" ? "removed" : "added"}. ${picks.length} balls, ${money(picks.length * config.amountCents, config.currency)}.`);
    };
    if (search instanceof HTMLInputElement && found) {
        search.addEventListener("input", () => {
            const n = Number(search.value);
            if (!Number.isInteger(n) || n < 1 || n > 1000) {
                found.textContent = "Enter a ball number from 001 to 1000.";
                return;
            }
            const block = Math.floor((n - 1) / 100) * 100 + 1;
            start = block;
            const state = visualFor(n, balls, picks);
            found.textContent = `${ballNumber(n)} is ${state === "sold" ? "sold" : "free"} — it's in ${ballNumber(block)}–${block + 99}.`;
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
        const qty = config.allowBallPicking ? picks.length : readQty();
        order.replaceChildren();
        if (config.allowBallPicking) {
            for (const n of readPicks()) {
                const line = document.createElement("div");
                const taken = dropped.has(n) || !isFree(balls.get(n));
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
        const kept = config.allowBallPicking ? readPicks().filter((n) => !dropped.has(n) && isFree(balls.get(n))) : [];
        const bill = (config.allowBallPicking ? kept.length : qty) * config.amountCents;
        const total = document.querySelector("#order-total");
        if (total)
            total.textContent = money(bill, config.currency);
        if (amount)
            amount.textContent = `Pay ${money(bill, config.currency)} · test`;
        const blocked = config.allowBallPicking && readPicks().some((n) => dropped.has(n) || !isFree(balls.get(n)));
        pay.disabled = blocked || bill === 0 || config.paymentsBlocked;
        pay.classList.toggle("off", pay.disabled);
        if (alert instanceof HTMLElement) {
            const takenNow = readPicks().filter((n) => !isFree(balls.get(n)));
            alert.hidden = takenNow.length === 0;
            if (takenNow.length && takenNow[0] !== undefined) {
                const n = takenNow[0];
                const alts = neighbours(n, balls, readPicks());
                alert.replaceChildren();
                const title = document.createElement("h3");
                title.textContent = `Ball ${ballNumber(n)} was just taken`;
                const copy = document.createElement("p");
                copy.textContent = "Someone else bought it while you were checking out. You haven't been charged for anything.";
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
                        writePicks([...new Set(readPicks().map((pick) => (pick === n ? swapTarget : pick)))]);
                        dropped = new Set();
                        draw();
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
    pay.addEventListener("click", () => {
        void submitCheckout(config, name.value, email.value, pay);
    });
}
async function submitCheckout(config, name, email, pay) {
    pay.disabled = true;
    writeBuyer(name, email);
    const recorded = [];
    try {
        if (config.allowBallPicking) {
            const fresh = inventoryOf(await getBalls());
            const picks = readPicks();
            if (picks.some((n) => !isFree(fresh.get(n)))) {
                pay.disabled = false;
                location.reload();
                return;
            }
            for (const n of picks) {
                const ball = fresh.get(n);
                if (!ball)
                    continue;
                const result = await buyBall({ email, buyerName: name, ballId: ball.id });
                recorded.push({ number: n, status: "recorded", reference: result.purchase.stripeTestReference });
            }
            writePicks([]);
        }
        else {
            for (let index = 0; index < readQty(); index += 1) {
                const result = await buyBall({ email, buyerName: name });
                recorded.push({
                    number: result.purchase.ball.ballNumber,
                    status: "recorded",
                    reference: result.purchase.stripeTestReference,
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
    lede.textContent = `Balls ${receipt.balls.map((ball) => ballNumber(ball.number)).join(", ")} are yours. On race day they'll tumble down High Street with the rest of the field.`;
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
    const links = document.createElement("p");
    links.className = "fine";
    const purchases = document.createElement("a");
    purchases.href = `/purchase?email=${encodeURIComponent(receipt.email)}`;
    purchases.textContent = "View purchases for this email";
    const records = document.createElement("a");
    records.href = `/selections?email=${encodeURIComponent(receipt.email)}`;
    records.textContent = "View the email and ball record";
    links.append(purchases, " · ", records);
    host.append(eye, title, lede, big, actions, table, next, links);
}
function initPurchase() {
    const form = document.querySelector("#lookup");
    const results = document.querySelector("#results");
    if (!(form instanceof HTMLFormElement) || !(results instanceof HTMLElement))
        return;
    const input = form.querySelector("input");
    const preset = new URLSearchParams(location.search).get("email") ?? "";
    if (input instanceof HTMLInputElement)
        input.value = preset;
    const show = async (email) => {
        results.replaceChildren("Loading purchases…");
        try {
            const payload = await purchasesFor(email);
            results.replaceChildren();
            if (payload.purchases.length === 0) {
                results.textContent = "No demo purchases for that email.";
                return;
            }
            for (const purchase of payload.purchases) {
                const card = document.createElement("article");
                card.className = "record";
                const title = document.createElement("h3");
                title.textContent = `Ball ${ballNumber(purchase.ball.ballNumber)}`;
                const status = document.createElement("p");
                status.textContent = `${purchase.status} · ${purchase.paymentMode} · charged: no`;
                const receipt = document.createElement("p");
                receipt.textContent = purchase.emailRecord
                    ? `Receipt “${purchase.emailRecord.subject}” — ${purchase.emailRecord.sent ? "sent" : "stored, not sent"}.`
                    : "No receipt stored for this row.";
                card.append(title, status, receipt);
                results.append(card);
            }
        }
        catch (error) {
            results.textContent = error instanceof Error ? error.message : "Lookup failed.";
        }
    };
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input instanceof HTMLInputElement)
            void show(input.value.trim());
    });
    if (preset)
        void show(preset);
}
function initSelections() {
    const form = document.querySelector("#lookup");
    const results = document.querySelector("#results");
    if (!(form instanceof HTMLFormElement) || !(results instanceof HTMLElement))
        return;
    const input = form.querySelector("input");
    const preset = new URLSearchParams(location.search).get("email") ?? "";
    if (input instanceof HTMLInputElement)
        input.value = preset;
    const show = async (email) => {
        results.replaceChildren("Loading records…");
        try {
            const payload = await selectionsFor(email);
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
                detail.textContent = `Ball ${selection.ballStatus}. Purchase ${selection.purchaseStatus}.`;
                const receipt = document.createElement("p");
                receipt.textContent = selection.emailRecord
                    ? `Receipt “${selection.emailRecord.subject}” — ${selection.emailRecord.sent ? "sent" : "stored, not sent"}.`
                    : "No receipt stored for this selection.";
                card.append(title, detail, receipt);
                results.append(card);
            }
        }
        catch (error) {
            results.textContent = error instanceof Error ? error.message : "Lookup failed.";
        }
    };
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input instanceof HTMLInputElement)
            void show(input.value.trim());
    });
    if (preset)
        void show(preset);
}
function initAdmin(balls) {
    const form = document.querySelector("#admin-form");
    const note = document.querySelector("#admin-status");
    const pick = document.querySelector("#admin-ball");
    if (!(form instanceof HTMLFormElement) || !(note instanceof HTMLElement) || !(pick instanceof HTMLInputElement))
        return;
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
        void offlineSale({ email, buyerName, ballId, note: String(data.get("note") ?? "") }, token)
            .then((result) => {
            note.textContent = `Ball ${ballNumber(result.purchase.ball.ballNumber)} recorded for ${result.purchase.buyerEmail}. Charged: no. Email sent: ${result.email.sent ? "yes" : "no"}.`;
            const ball = balls.get(result.purchase.ball.ballNumber);
            if (ball)
                ball.status = "sold";
        })
            .catch((error) => {
            note.textContent = error instanceof Error ? error.message : "Could not record that sale.";
        });
    });
}
void boot();
