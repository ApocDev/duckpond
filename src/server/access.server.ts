const allowedHosts = () =>
  new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.DUCKPOND_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ]);

export function requireAllowedRequest(request: Request) {
  const hosts = allowedHosts();
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!hosts.has(url.hostname) || (origin && !hosts.has(new URL(origin).hostname)))
    throw new Error("This hostname is not enabled for Duckpond.");
}
