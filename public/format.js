const PALETTE = [
    "#FFC234",
    "#FF8A3D",
    "#FF5C7A",
    "#FF85C0",
    "#9370F0",
    "#3DA9F5",
    "#18BFA9",
    "#7CCF4E",
    "#2F6BD8",
];
function mix(hex, other, t) {
    const channel = (value, index) => Number.parseInt(value.slice(index, index + 2), 16);
    const parts = [1, 3, 5].map((index) => {
        const from = channel(hex, index);
        const to = channel(other, index);
        return Math.round(from + (to - from) * t)
            .toString(16)
            .padStart(2, "0");
    });
    return `#${parts.join("")}`;
}
export function ballColour(n) {
    const c = PALETTE[(n * 7 + Math.floor(n / 9)) % PALETTE.length] ?? PALETTE[0] ?? "#FFC234";
    return { c, hi: mix(c, "#FFFFFF", 0.45), lo: mix(c, "#000000", 0.28) };
}
export function ballNumber(n) {
    return n >= 1000 ? String(n) : String(n).padStart(3, "0");
}
function mixSeed(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function shuffleNumbers(items, seed) {
    const copy = [...items];
    const random = mixSeed(seed);
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        const left = copy[index];
        const right = copy[swap];
        if (left === undefined || right === undefined)
            continue;
        copy[index] = right;
        copy[swap] = left;
    }
    return copy;
}
export function marqueeNumbers(balls, count, seed) {
    if (count <= 0 || balls.length === 0)
        return [];
    const shaded = balls.filter((ball) => ball.status !== "available").map((ball) => ball.ballNumber);
    const open = balls.filter((ball) => ball.status === "available").map((ball) => ball.ballNumber);
    const shadedOrder = shuffleNumbers(shaded, seed);
    const chosen = shadedOrder.length >= count
        ? shadedOrder.slice(0, count)
        : [...shadedOrder, ...shuffleNumbers(open, seed + 1).slice(0, count - shadedOrder.length)];
    return shuffleNumbers(chosen, seed + 2);
}
export function money(cents, currency) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}
export function customerHoldSummary(reservation) {
    const pending = reservation.holds.filter((hold) => hold.state === "pending_payment");
    const open = reservation.session?.status === "open" && pending.length > 0;
    return {
        confirmed: reservation.owned.map((ball) => ({
            ballId: ball.ballId,
            ballNumber: ball.ballNumber,
            receiptToken: ball.receiptToken,
        })),
        pending: pending.map((hold) => ({
            ballId: hold.ballId,
            ballNumber: hold.ballNumber,
            expiresAt: hold.expiresAt,
        })),
        remainingMs: open ? Math.max(0, reservation.session?.remainingMs ?? 0) : 0,
    };
}
