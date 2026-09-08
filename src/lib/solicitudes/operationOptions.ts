// PAY0 H4-D70-A8B
// Fuente canonica para reconocer operaciones FACTURA SUBTOTAL.

export type SolicitudOperationOptionLike = {
  label?: unknown;
  value?: unknown;
};

const FACTURA_SUBTOTAL_LABEL = "factura subtotal";
const FACTURA_SUBTOTAL_VALUES = [
  "factura subtotal",
  "factura_subtotal",
  "factura-subtotal",
] as const;

export function normalizeSolicitudOperationText(
  value: unknown,
): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function findFacturaSubtotalOperation<
  T extends SolicitudOperationOptionLike,
>(
  options: readonly T[],
): T | null {
  return (
    options.find((option) => {
      const label = normalizeSolicitudOperationText(
        option.label,
      );
      const value = normalizeSolicitudOperationText(
        option.value,
      );

      return (
        label === FACTURA_SUBTOTAL_LABEL ||
        label.includes(FACTURA_SUBTOTAL_LABEL) ||
        FACTURA_SUBTOTAL_VALUES.some(
          (candidate) =>
            value === candidate ||
            value.includes(candidate),
        )
      );
    }) ?? null
  );
}
