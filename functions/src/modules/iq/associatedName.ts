export function resolveIqAssociatedName(username: string, configuredName?: unknown): string {
  // IQ may use "ASOCIADO RR" to log in while its catalogs name the partner "RR".
  const configured = String(configuredName ?? "").replace(/\s+/g, " ").trim();
  const login = username.replace(/\s+/g, " ").trim();
  const name = configured || login;
  return name.match(/^ASOCIADO\s+(.+)$/i)?.[1] || name;
}
