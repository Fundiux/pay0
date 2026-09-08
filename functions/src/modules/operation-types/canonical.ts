
export function normalizeOperationTypeKey(input: unknown) {
  return String(input ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

export function buildOperationTypeAliases(input: {
  key?: unknown;
  name?: unknown;
}) {
  const candidates = [
    normalizeOperationTypeKey(input?.key),
    normalizeOperationTypeKey(input?.name),
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}
