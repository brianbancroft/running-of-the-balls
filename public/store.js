const PICKS = "rotb-picks";
const QTY = "rotb-qty";
const PAUSED = "rotb-paused";
const SEED = "rotb-field-seed";
const RECEIPT = "rotb-last-receipt";
const DETAILS = "rotb-buyer";
export function readPicks() {
    const raw = sessionStorage.getItem(PICKS);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((value) => typeof value === "number" && Number.isInteger(value));
    }
    catch {
        return [];
    }
}
export function writePicks(picks) {
    sessionStorage.setItem(PICKS, JSON.stringify(picks));
}
export function readQty() {
    const value = Number(sessionStorage.getItem(QTY) ?? "1");
    if (!Number.isInteger(value) || value < 1)
        return 1;
    return Math.min(value, 99);
}
export function writeQty(qty) {
    sessionStorage.setItem(QTY, String(qty));
}
export function readPaused() {
    return sessionStorage.getItem(PAUSED) === "1";
}
export function writePaused(paused) {
    sessionStorage.setItem(PAUSED, paused ? "1" : "0");
}
export function fieldSeed() {
    const existing = sessionStorage.getItem(SEED);
    if (existing && /^\d+$/.test(existing))
        return Number(existing);
    const seed = Math.floor(Math.random() * 1_000_000_000);
    sessionStorage.setItem(SEED, String(seed));
    return seed;
}
export function readBuyer() {
    const raw = sessionStorage.getItem(DETAILS);
    if (!raw)
        return { name: "", email: "" };
    try {
        const parsed = JSON.parse(raw);
        return {
            name: typeof parsed.name === "string" ? parsed.name : "",
            email: typeof parsed.email === "string" ? parsed.email : "",
        };
    }
    catch {
        return { name: "", email: "" };
    }
}
export function writeBuyer(name, email) {
    sessionStorage.setItem(DETAILS, JSON.stringify({ name, email }));
}
export function readReceipt() {
    const raw = sessionStorage.getItem(RECEIPT);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeReceipt(receipt) {
    sessionStorage.setItem(RECEIPT, JSON.stringify(receipt));
}
