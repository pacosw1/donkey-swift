/** JSON response with the given status code. */
export function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
/** JSON error response: { "error": message }. */
export function errorResponse(status, message) {
    return jsonResponse(status, { error: message });
}
/** Decode JSON request body into type T. */
export async function decodeJson(request) {
    return (await request.json());
}
/** Extract client IP from X-Forwarded-For, X-Real-IP, or connection. */
export function getClientIp(request) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff)
        return xff.split(",")[0].trim();
    const xri = request.headers.get("x-real-ip");
    if (xri)
        return xri;
    return "unknown";
}
//# sourceMappingURL=index.js.map