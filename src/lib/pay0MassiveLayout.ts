export type Pay0MassiveLayoutMode = "BENEFICIARIOS" | "DISPERSIONES";

export type Pay0DestinationKind = "CLABE" | "TARJETA" | "EFECTIVO";

export type Pay0MassiveMethodTipo = "DEBITO" | "TDC" | "AMEX";

export interface Pay0MassiveParseOptions {
  methodTipo?: Pay0MassiveMethodTipo;
}

export interface Pay0MassiveRawRow {
  [key: string]: unknown;
}

export interface Pay0MassiveParsedRow {
  rowNumber: number;
  nombre: string;
  monto: number | null;
  banco: string;
  bankCode: string;
  clabe: string;
  cuenta: string;
  numeroTarjeta: string;
  destinationKind: Pay0DestinationKind;
  methodTipo: Pay0MassiveMethodTipo;
  tipo: Pay0MassiveMethodTipo;
  errors: string[];
  warnings: string[];
}

export interface Pay0MassiveParseResult {
  mode: Pay0MassiveLayoutMode;
  rows: Pay0MassiveParsedRow[];
  validRows: Pay0MassiveParsedRow[];
  errorRows: Pay0MassiveParsedRow[];
  totals: {
    rows: number;
    valid: number;
    errors: number;
    totalAmount: number;
  };
}

export const PAY0_MASSIVE_LAYOUT_HEADERS = [
  "NOMBRE",
  "MONTO",
  "BANCO",
  "CLABE",
  "CUENTA",
  "NUMERO DE TARJETA",
] as const;

const BANK_ALIAS_TO_CANONICAL: Record<string, string> = {
  BANAMEX: "BANAMEX",
  CITIBANAMEX: "BANAMEX",
  "BANCO NACIONAL DE MEXICO": "BANAMEX",
  BBVA: "BBVA MEXICO",
  "BBVA MEXICO": "BBVA MEXICO",
  BANCOMER: "BBVA MEXICO",
  SANTANDER: "SANTANDER",
  HSBC: "HSBC",
  BAJIO: "BANBAJIO",
  BANBAJIO: "BANBAJIO",
  INBURSA: "INBURSA",
  MIFEL: "MIFEL",
  SCOTIABANK: "SCOTIABANK",
  BANREGIO: "BANREGIO",
  INVEX: "INVEX",
  AFIRME: "AFIRME",
  BANORTE: "BANORTE",
  IXE: "BANORTE",
  BANCOPPEL: "BANCOPPEL",
  BANCOPEL: "BANCOPPEL",
  "BANCO COPPEL": "BANCOPPEL",
  AZTECA: "BANCO AZTECA",
  "BANCO AZTECA": "BANCO AZTECA",
  STP: "STP",
  NU: "NU MEXICO",
  "NU MEXICO": "NU MEXICO",
  "MERCADO PAGO": "MERCADO PAGO",
  "MERCADO PAGO W": "MERCADO PAGO",
};

const BANK_ALIAS_TO_CODE: Record<string, string> = {
  BANAMEX: "002",
  CITIBANAMEX: "002",
  "BANCO NACIONAL DE MEXICO": "002",
  BBVA: "012",
  "BBVA MEXICO": "012",
  BANCOMER: "012",
  SANTANDER: "014",
  HSBC: "021",
  BAJIO: "030",
  BANBAJIO: "030",
  INBURSA: "036",
  MIFEL: "042",
  SCOTIABANK: "044",
  BANREGIO: "058",
  INVEX: "059",
  AFIRME: "062",
  BANORTE: "072",
  IXE: "072",
  AZTECA: "127",
  "BANCO AZTECA": "127",
  BANCOPPEL: "137",
  BANCOPEL: "137",
  "BANCO COPPEL": "137",
  NU: "638",
  "NU MEXICO": "638",
  STP: "646",
  "MERCADO PAGO": "722",
  "MERCADO PAGO W": "722",
};

const BANK_CODE_TO_CANONICAL: Record<string, string> = {
  "002": "BANAMEX",
  "012": "BBVA MEXICO",
  "014": "SANTANDER",
  "021": "HSBC",
  "030": "BANBAJIO",
  "036": "INBURSA",
  "042": "MIFEL",
  "044": "SCOTIABANK",
  "058": "BANREGIO",
  "059": "INVEX",
  "062": "AFIRME",
  "072": "BANORTE",
  "127": "BANCO AZTECA",
  "137": "BANCOPPEL",
  "638": "NU MEXICO",
  "646": "STP",
  "722": "MERCADO PAGO",
};

function normalizeHeader(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function parseMoney(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");

  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;

  return Math.round(num * 100) / 100;
}

function getValue(row: Pay0MassiveRawRow, canonicalHeader: string) {
  const wanted = normalizeHeader(canonicalHeader);
  const key = Object.keys(row || {}).find((item) => normalizeHeader(item) === wanted);
  return key ? row[key] : "";
}

function resolveMethodTipo(value: unknown): Pay0MassiveMethodTipo {
  const normalized = normalizeHeader(String(value || ""));
  if (normalized === "TDC") return "TDC";
  if (normalized === "AMEX" || normalized === "AMERICAN EXPRESS") return "AMEX";
  return "DEBITO";
}

function detectDestinationKind(clabe: string, numeroTarjeta: string): Pay0DestinationKind {
  if (clabe) return "CLABE";
  if (numeroTarjeta) return "TARJETA";
  return "EFECTIVO";
}

function resolveMassiveBankCode(bankName: string, clabeValue: string) {
  const clabeDigits = onlyDigits(clabeValue);

  if (clabeDigits.length === 18) {
    return clabeDigits.slice(0, 3);
  }

  const normalized = normalizeHeader(bankName);
  return BANK_ALIAS_TO_CODE[normalized] || "";
}

function normalizeMassiveBankName(bankName: string, clabeValue: string) {
  const raw = String(bankName || "").trim();
  const normalized = normalizeHeader(raw);
  const clabeDigits = onlyDigits(clabeValue);

  if (clabeDigits.length === 18) {
    const code = clabeDigits.slice(0, 3);
    return BANK_CODE_TO_CANONICAL[code] || BANK_ALIAS_TO_CANONICAL[normalized] || raw;
  }

  return BANK_ALIAS_TO_CANONICAL[normalized] || raw;
}

function validateRow(mode: Pay0MassiveLayoutMode, parsed: Pay0MassiveParsedRow) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parsed.nombre) {
    errors.push("NOMBRE requerido.");
  }

  if (mode === "DISPERSIONES") {
    if (parsed.monto === null || parsed.monto <= 0) {
      errors.push("MONTO requerido y mayor a 0.");
    }
  }

  if (parsed.destinationKind === "CLABE") {
    if (parsed.methodTipo !== "DEBITO") {
      errors.push(`${parsed.methodTipo} requiere NUMERO DE TARJETA.`);
    }

    if (parsed.clabe.length !== 18) {
      errors.push("CLABE debe tener 18 digitos.");
    }

    if (!parsed.banco) {
      errors.push("BANCO requerido para CLABE.");
    }
  }

  if (parsed.destinationKind === "TARJETA") {
    const requiredLength = parsed.methodTipo === "AMEX" ? 15 : 16;

    if (parsed.numeroTarjeta.length !== requiredLength) {
      errors.push(
        parsed.methodTipo === "AMEX"
          ? "NUMERO DE TARJETA AMEX debe tener 15 digitos."
          : "NUMERO DE TARJETA debe tener 16 digitos."
      );
    }

    if (!parsed.banco) {
      errors.push("BANCO requerido para tarjeta.");
    }

    if (parsed.banco && !resolveMassiveBankCode(parsed.banco, "")) {
      errors.push("BANCO no reconocido para tarjeta.");
    }
  }

  if (parsed.destinationKind === "EFECTIVO") {
    errors.push("CLABE o NUMERO DE TARJETA requerido. EFECTIVO no aplica para layout masivo.");
  }

  return { errors, warnings };
}

export function parsePay0MassiveLayoutRows(
  rows: Pay0MassiveRawRow[],
  mode: Pay0MassiveLayoutMode,
  options: Pay0MassiveParseOptions = {}
): Pay0MassiveParseResult {
  const methodTipo = resolveMethodTipo(options.methodTipo);

  const parsedRows = (rows || [])
    .map((row, index) => {
      const nombre = normalizeText(getValue(row, "NOMBRE"));
      const monto = parseMoney(getValue(row, "MONTO"));
      const rawBanco = normalizeText(getValue(row, "BANCO"));
      const clabe = onlyDigits(getValue(row, "CLABE"));
      const cuenta = normalizeText(getValue(row, "CUENTA"));
      const numeroTarjeta = onlyDigits(getValue(row, "NUMERO DE TARJETA"));
      const banco = normalizeMassiveBankName(rawBanco, clabe);
      const bankCode = resolveMassiveBankCode(rawBanco, clabe);
      const destinationKind = detectDestinationKind(clabe, numeroTarjeta);

      const parsed: Pay0MassiveParsedRow = {
        rowNumber: index + 2,
        nombre,
        monto,
        banco,
        bankCode,
        clabe,
        cuenta,
        numeroTarjeta,
        destinationKind,
        methodTipo,
        tipo: methodTipo,
        errors: [],
        warnings: [],
      };

      const validation = validateRow(mode, parsed);

      return {
        ...parsed,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    })
    .filter((row) => {
      return Boolean(
        row.nombre ||
        row.monto !== null ||
        row.banco ||
        row.clabe ||
        row.cuenta ||
        row.numeroTarjeta
      );
    });

  const validRows = parsedRows.filter((row) => row.errors.length === 0);
  const errorRows = parsedRows.filter((row) => row.errors.length > 0);

  return {
    mode,
    rows: parsedRows,
    validRows,
    errorRows,
    totals: {
      rows: parsedRows.length,
      valid: validRows.length,
      errors: errorRows.length,
      totalAmount: validRows.reduce((sum, row) => sum + (row.monto || 0), 0),
    },
  };
}