export function handleHttpRequest(req, res, metadata) {
  const pathname = new URL(req.url || "/", "http://gateway.internal").pathname;
  if (req.method === "GET" && pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: metadata.service, revision: metadata.revision, version: metadata.version }));
    return pathname;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
  return pathname;
}

export function isAllowedVoiceOrigin(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.has(origin)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.origin === origin;
  } catch {
    return false;
  }
}
