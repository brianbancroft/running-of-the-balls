async function send(url, init) {
    const response = await fetch(url, init);
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
export function selectionsFor(email, token) {
    const headers = { accept: "application/json" };
    if (token.trim())
        headers.authorization = `Bearer ${token}`;
    return send(`/api/admin/selections?email=${encodeURIComponent(email)}`, {
        credentials: "same-origin",
        headers,
    });
}
