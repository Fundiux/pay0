export const HUGO_SYSTEM_CATALOG = [
  { id: "PAY0", module: "dashboard", status: "CONNECTED" },
  { id: "ASSETS", module: "assets", status: "CONNECTED" },
  { id: "HUGO", module: "hugo", status: "CONNECTED" },
  { id: "TTT", module: "ttt", status: "NOT_CONNECTED" },
] as const;

export function publicHugoSystemCatalog() {
  return HUGO_SYSTEM_CATALOG.map(({ id, status }) => ({ id, status }));
}
