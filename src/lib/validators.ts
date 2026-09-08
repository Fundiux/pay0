export function toNumberStrict(input: string | number): number {
  const n = typeof input === "number" ? input : Number(String(input).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error("Número inválido");
  return n;
}

export function toPositiveNumber(input: string | number): number {
  const n = toNumberStrict(input);
  if (n <= 0) throw new Error("Debe ser mayor a 0");
  return n;
}

