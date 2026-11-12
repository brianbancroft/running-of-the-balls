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

function mix(hex: string, other: string, t: number): string {
  const channel = (value: string, index: number) => Number.parseInt(value.slice(index, index + 2), 16);
  const parts = [1, 3, 5].map((index) => {
    const from = channel(hex, index);
    const to = channel(other, index);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${parts.join("")}`;
}

export function ballColour(n: number): { c: string; hi: string; lo: string } {
  const c = PALETTE[(n * 7 + Math.floor(n / 9)) % PALETTE.length] ?? PALETTE[0] ?? "#FFC234";
  return { c, hi: mix(c, "#FFFFFF", 0.45), lo: mix(c, "#000000", 0.28) };
}

export function ballNumber(n: number): string {
  return n === 1000 ? "1000" : String(n).padStart(3, "0");
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}
