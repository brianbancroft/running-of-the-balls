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
export function money(cents, currency) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}
