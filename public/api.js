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
    return send("/api/admin/offline-sales", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
}
export function purchasesFor(email) {
    return send(`/api/purchases?email=${encodeURIComponent(email)}`);
}
export function selectionsFor(email) {
    return send(`/api/selections?email=${encodeURIComponent(email)}`);
}
