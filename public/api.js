async function send(url, init) {
    const response = await fetch(url, { credentials: "same-origin", ...init });
    const payload = (await response.json());
    if (!response.ok)
        throw new Error(payload.error ?? "Request failed.");
    return payload;
}
export function getConfig() {
    return send("/api/config");
}
export function getSession() {
    return send("/api/auth/session");
}
export function getBalls() {
    return send("/api/balls").then((payload) => payload.balls);
}
export function buyBall(body) {
    return send("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
    });
}
export function offlineSale(body, token) {
    const headers = {
        "content-type": "application/json",
        accept: "application/json",
    };
    if (token.trim())
        headers.authorization = `Bearer ${token}`;
    return send("/api/admin/offline-sales", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(body),
    });
}
export function purchaseForToken(token) {
    return send(`/api/purchases?token=${encodeURIComponent(token)}`);
}
function adminHeaders(token, json = false) {
    const headers = { accept: json ? "application/json" : "text/csv" };
    if (json)
        headers["content-type"] = "application/json";
    if (token.trim())
        headers.authorization = `Bearer ${token}`;
    return headers;
}
export function listSales(token) {
    return send("/api/admin/sales", { credentials: "same-origin", headers: adminHeaders(token, true) });
}
export function voidSale(purchaseId, reason, token) {
    return send(`/api/admin/purchases/${encodeURIComponent(purchaseId)}/void`, {
        method: "POST",
        credentials: "same-origin",
        headers: adminHeaders(token, true),
        body: JSON.stringify({ reason }),
    });
}
export async function downloadCsv(filename, token) {
    const response = await fetch(`/api/admin/exports/${encodeURIComponent(filename)}`, {
        credentials: "same-origin",
        headers: adminHeaders(token),
    });
    if (!response.ok) {
        let message = "Download failed.";
        try {
            const payload = (await response.json());
            if (payload.error)
                message = payload.error;
        }
        catch {
            message = "Download failed.";
        }
        throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
export function getReservation() {
    return send("/api/reservations");
}
export function holdReservation(ballId) {
    return send("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ballId }),
    });
}
export function releaseReservation(ballId) {
    return send("/api/reservations/release", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ballId }),
    });
}
export function checkoutReservation(body) {
    return send("/api/reservations/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
    });
}
export function selectionsFor(email, token) {
    const headers = { accept: "application/json" };
    if (token.trim())
        headers.authorization = `Bearer ${token}`;
    return send(`/api/admin/selections?email=${encodeURIComponent(email)}`, {
        credentials: "same-origin",
        headers,
    });
}
