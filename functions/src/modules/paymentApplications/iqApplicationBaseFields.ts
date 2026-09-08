export type CanonicalIqField =
  | "ASOCIADO"
  | "CLIENTE"
  | "EMPRESA"
  | "DEPOSITO"
  | "FACTURA"
  | "MONTO";

export type CanonicalIqSelectionMethod =
  | "LABEL_OPTION"
  | "KEYBOARD_FILTER"
  | "VISIBLE_FOLIO_CLICK";

export type CanonicalIqItem = {
  key: string;
  solicitudIqFolio: string;
  amount: number;
};

export type CanonicalIqItemResult = {
  key: string;
  solicitudIqFolio: string;
  expectedAmount: number;
  rowMatched: boolean;
  amountMatched: number;
  status: "PENDING" | "VERIFIED" | "SUCCEEDED" | "REJECTED" | "UNKNOWN";
  message: string;
};

export type CanonicalIqFieldCheck = {
  field: CanonicalIqField;
  expected: string;
  selected: string;
  ok: boolean;
  message: string;
};

export type CanonicalBaseInput = {
  planId: string;
  pagoIqFolio: string;
  asociadoName?: string;
  clienteName?: string;
  empresaName?: string;
  items: CanonicalIqItem[];
  selectionMethod?: CanonicalIqSelectionMethod;
};

export type CanonicalBaseAdapters = {
  requireField: (
    marker: string,
    field: CanonicalIqField,
    aliases: string[],
  ) => Promise<string>;
  selectField: (params: {
    selector: string;
    field: CanonicalIqField;
    expected: string;
    mode: "FOLIO" | "TEXT";
    method?: CanonicalIqSelectionMethod;
  }) => Promise<CanonicalIqFieldCheck>;
  bindExistingItem: (
    item: CanonicalIqItem,
  ) => Promise<CanonicalIqItemResult>;
  appendItem: (
    item: CanonicalIqItem,
  ) => Promise<CanonicalIqItemResult>;
};

export type CanonicalBaseResult = {
  ok: boolean;
  verified: boolean;
  status: string;
  message: string;
  responseMessage: string;
  depositMatched: string;
  fieldChecks: CanonicalIqFieldCheck[];
  itemResults: CanonicalIqItemResult[];
  errors: string[];
};

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * H4-D66-A33_CANONICAL_BASE
 *
 * Responsabilidad exclusiva e inmutable:
 * Asociado -> Cliente -> Empresa -> Deposito -> Factura.
 *
 * Este modulo NO conoce ni escribe Monto.
 * Este modulo NO presiona Crear.
 * Este modulo NO interpreta el resultado posterior al submit.
 */
export async function runCanonicalIqApplicationBaseFields(
  input: CanonicalBaseInput,
  adapters: CanonicalBaseAdapters,
): Promise<CanonicalBaseResult> {
  const errors: string[] = [];
  const fieldChecks: CanonicalIqFieldCheck[] = [];
  const itemResults: CanonicalIqItemResult[] = [];

  const fail = (
    status: string,
    message: string,
    responseMessage = "",
    depositMatched = "",
  ): CanonicalBaseResult => ({
    ok: false,
    verified: false,
    status,
    message,
    responseMessage,
    depositMatched,
    fieldChecks,
    itemResults,
    errors,
  });

  if (cleanText(input.asociadoName)) {
    const selector = await adapters.requireField(
      `asociado-${input.planId}`,
      "ASOCIADO",
      ["asociado"],
    );

    const check = await adapters.selectField({
      selector,
      field: "ASOCIADO",
      expected: cleanText(input.asociadoName),
      mode: "TEXT",
      method: input.selectionMethod,
    });

    fieldChecks.push(check);

    if (!check.ok) {
      errors.push(check.message);
      return fail(
        "IQ_PAYMENT_APPLICATION_ASSOCIATED_NOT_MATCHED",
        errors.join(" "),
      );
    }
  }

  if (cleanText(input.clienteName)) {
    const selector = await adapters.requireField(
      `cliente-${input.planId}`,
      "CLIENTE",
      ["cliente"],
    );

    const check = await adapters.selectField({
      selector,
      field: "CLIENTE",
      expected: cleanText(input.clienteName),
      mode: "TEXT",
      method: input.selectionMethod,
    });

    fieldChecks.push(check);

    if (!check.ok) {
      errors.push(check.message);
      return fail(
        "IQ_PAYMENT_APPLICATION_CLIENT_NOT_MATCHED",
        errors.join(" "),
      );
    }
  }

  if (cleanText(input.empresaName)) {
    const selector = await adapters.requireField(
      `empresa-${input.planId}`,
      "EMPRESA",
      ["empresa"],
    );

    const check = await adapters.selectField({
      selector,
      field: "EMPRESA",
      expected: cleanText(input.empresaName),
      mode: "TEXT",
      method: input.selectionMethod,
    });

    fieldChecks.push(check);

    if (!check.ok) {
      errors.push(check.message);
      return fail(
        "IQ_PAYMENT_APPLICATION_COMPANY_NOT_MATCHED",
        errors.join(" "),
      );
    }
  }

  const depositSelector = await adapters.requireField(
    `deposit-${input.planId}`,
    "DEPOSITO",
    [
      "deposito",
      "folio deposito",
      "deposit_id",
      "deposit",
      "pago iq",
      "payment_id",
    ],
  );

  const depositCheck = await adapters.selectField({
    selector: depositSelector,
    field: "DEPOSITO",
    expected: cleanText(input.pagoIqFolio),
    mode: "FOLIO",
    method: input.selectionMethod,
  });

  fieldChecks.push(depositCheck);
  const depositMatched = depositCheck.selected;

  if (!depositCheck.ok) {
    errors.push(depositCheck.message);
    return fail(
      "IQ_PAYMENT_APPLICATION_DEPOSIT_NOT_MATCHED",
      errors.join(" "),
      fieldChecks.map((check) => check.message).join(" | "),
      depositMatched,
    );
  }

  for (const item of input.items) {
    let itemResult = await adapters.bindExistingItem(item);

    if (itemResult.status !== "VERIFIED") {
      itemResult = await adapters.appendItem(item);
    }

    itemResults.push(itemResult);
  }

  const verified =
    itemResults.length === input.items.length &&
    itemResults.every(
      (item) =>
        item.status === "VERIFIED" &&
        item.amountMatched === item.expectedAmount,
    );

  if (!verified) {
    const missing = itemResults
      .filter((item) => item.status !== "VERIFIED")
      .map((item) => item.solicitudIqFolio);

    errors.push(
      `No se verificaron exactamente todas las facturas IQ: ${
        missing.join(", ") || "desconocidas"
      }.`,
    );

    return fail(
      "IQ_PAYMENT_APPLICATION_NOT_VERIFIED",
      errors.join(" "),
      "",
      depositMatched,
    );
  }

  return {
    ok: true,
    verified: true,
    status: "IQ_PAYMENT_APPLICATION_BASE_VERIFIED",
    message: "Base canonica IQ verificada.",
    responseMessage: "",
    depositMatched,
    fieldChecks,
    itemResults,
    errors,
  };
}