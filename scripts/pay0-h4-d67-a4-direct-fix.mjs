
import fs from "node:fs";

const pagePath = "src/app/pagos/page.tsx";
const cssPath = "src/styles/globals.css";
const relationPath = "src/components/PaymentRelationIndicator.tsx";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function replaceExactly(source, oldValue, newValue, expectedCount, label) {
  const count = source.split(oldValue).length - 1;
  if (count !== expectedCount) {
    fail(`${label}: esperado ${expectedCount}, encontrado ${count}.`);
  }
  return source.split(oldValue).join(newValue);
}

function removeRange(source, startMarker, endMarker, keepEnd, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) fail(`${label}: no se encontro inicio.`);
  const endStart = source.indexOf(endMarker, start);
  if (endStart < 0) fail(`${label}: no se encontro fin.`);
  const end = keepEnd ? endStart : endStart + endMarker.length;
  return source.slice(0, start) + source.slice(end);
}

let page = fs.readFileSync(pagePath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

const requiredPageMarkers = [
  "H4-D67-A1B_RELATION_COLUMN",
  '<table className="pay0-pagos-main-table',
  '<col className="pay0-col-iq-folio" />',
  '<col className="pay0-col-iq-status" />',
  '{ label: "Relacion", key: "totalAplicado" }',
  "<PaymentRelationIndicator payment={p} />",
  "colSpan={14}",
];

for (const marker of requiredPageMarkers) {
  if (!page.includes(marker)) fail(`page.tsx sin marcador requerido: ${marker}`);
}

page = removeRange(
  page,
  "  /* pay0-pagos-main-table ui canon moved */",
  '\n\n  return (\n    <div className={`flex ${wrapper}`}>',
  true,
  "Eliminar useEffect heredado de 11 columnas",
);

page = replaceExactly(
  page,
  `            <col className="pay0-col-iq-folio" />
            <col className="pay0-col-iq-status" />`,
  `            <col className="pay0-col-iq-folio" />
            <col className="pay0-col-relacion" />
            <col className="pay0-col-iq-status" />`,
  1,
  "Insertar col RELACION",
);

page = replaceExactly(
  page,
  '{ label: "Relacion", key: "totalAplicado" }',
  '{ label: "Relacion", key: "montoAplicado" }',
  1,
  "Corregir key RELACION",
);

page = replaceExactly(
  page,
  "min-w-[1460px]",
  "min-w-[1355px]",
  1,
  "Ajustar ancho minimo tabla",
);

page = replaceExactly(
  page,
  "colSpan={14}",
  "colSpan={15}",
  2,
  "Corregir colSpan",
);

if (!page.includes("H4-D67-A4_CANONICAL_15_COLUMNS")) {
  page = page.replace(
    '<colgroup className="pay0-pagos-colgroup">',
    '<colgroup className="pay0-pagos-colgroup">{/* H4-D67-A4_CANONICAL_15_COLUMNS */}',
  );
}

css = removeRange(
  css,
  "/* Distribucion canonica de anchos */",
  "/* Folio, Fecha, Cliente y Empresa a la izquierda */",
  true,
  "Eliminar CSS historico Pagos 11 columnas",
);

css = removeRange(
  css,
  "/* H4-D67-A2_PAGOS_15_COL_LAYOUT_BEGIN */",
  "/* H4-D67-A2_PAGOS_15_COL_LAYOUT_END */",
  false,
  "Eliminar bloque A2 incorrecto",
);

const canonicalCss = String.raw`
/* H4-D67-A4_PAGOS_CANONICAL_LAYOUT_BEGIN */

/*
  Pagos: geometria unica de 15 columnas.
  No agregar reglas nth-child de Pagos fuera de este bloque.
*/

.pay0-pagos-main-table {
  width: 100% !important;
  min-width: 1355px !important;
  table-layout: fixed !important;
}

/* Colgroup canonico: 15 columnas, 1355px base */
.pay0-pagos-main-table .pay0-col-folio { width: 85px !important; }
.pay0-pagos-main-table .pay0-col-iq-folio { width: 70px !important; }
.pay0-pagos-main-table .pay0-col-relacion { width: 40px !important; }
.pay0-pagos-main-table .pay0-col-iq-status { width: 95px !important; }
.pay0-pagos-main-table .pay0-col-fecha { width: 85px !important; }
.pay0-pagos-main-table .pay0-col-cliente { width: 200px !important; }
.pay0-pagos-main-table .pay0-col-empresa { width: 160px !important; }
.pay0-pagos-main-table .pay0-col-monto { width: 90px !important; }
.pay0-pagos-main-table .pay0-col-aplicado { width: 90px !important; }
.pay0-pagos-main-table .pay0-col-disponible { width: 90px !important; }
.pay0-pagos-main-table .pay0-col-pendientes { width: 70px !important; }
.pay0-pagos-main-table .pay0-col-doc { width: 40px !important; }
.pay0-pagos-main-table .pay0-col-nota { width: 40px !important; }
.pay0-pagos-main-table .pay0-col-estatus { width: 85px !important; }
.pay0-pagos-main-table .pay0-col-acciones { width: 115px !important; }

.pay0-pagos-main-table th,
.pay0-pagos-main-table td {
  box-sizing: border-box !important;
  min-width: 0 !important;
  max-width: none !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
  vertical-align: middle !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.pay0-pagos-main-table th > *,
.pay0-pagos-main-table td > * {
  min-width: 0 !important;
  max-width: 100% !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

/* Izquierda: Folio, Cliente, Empresa */
.pay0-pagos-main-table th:nth-child(1),
.pay0-pagos-main-table td:nth-child(1),
.pay0-pagos-main-table th:nth-child(6),
.pay0-pagos-main-table td:nth-child(6),
.pay0-pagos-main-table th:nth-child(7),
.pay0-pagos-main-table td:nth-child(7) {
  text-align: left !important;
}

.pay0-pagos-main-table th:nth-child(1) > *,
.pay0-pagos-main-table td:nth-child(1) > *,
.pay0-pagos-main-table th:nth-child(6) > *,
.pay0-pagos-main-table td:nth-child(6) > *,
.pay0-pagos-main-table th:nth-child(7) > *,
.pay0-pagos-main-table td:nth-child(7) > * {
  width: 100% !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  text-align: left !important;
  justify-content: flex-start !important;
}

/* Centro: Folio IQ, Relacion, Estado IQ, Fecha y columnas operativas */
.pay0-pagos-main-table th:nth-child(2),
.pay0-pagos-main-table td:nth-child(2),
.pay0-pagos-main-table th:nth-child(3),
.pay0-pagos-main-table td:nth-child(3),
.pay0-pagos-main-table th:nth-child(4),
.pay0-pagos-main-table td:nth-child(4),
.pay0-pagos-main-table th:nth-child(5),
.pay0-pagos-main-table td:nth-child(5),
.pay0-pagos-main-table th:nth-child(8),
.pay0-pagos-main-table td:nth-child(8),
.pay0-pagos-main-table th:nth-child(9),
.pay0-pagos-main-table td:nth-child(9),
.pay0-pagos-main-table th:nth-child(10),
.pay0-pagos-main-table td:nth-child(10),
.pay0-pagos-main-table th:nth-child(11),
.pay0-pagos-main-table td:nth-child(11),
.pay0-pagos-main-table th:nth-child(12),
.pay0-pagos-main-table td:nth-child(12),
.pay0-pagos-main-table th:nth-child(13),
.pay0-pagos-main-table td:nth-child(13),
.pay0-pagos-main-table th:nth-child(14),
.pay0-pagos-main-table td:nth-child(14),
.pay0-pagos-main-table th:nth-child(15),
.pay0-pagos-main-table td:nth-child(15) {
  text-align: center !important;
}

.pay0-pagos-main-table th:nth-child(2) > *,
.pay0-pagos-main-table td:nth-child(2) > *,
.pay0-pagos-main-table th:nth-child(3) > *,
.pay0-pagos-main-table td:nth-child(3) > *,
.pay0-pagos-main-table th:nth-child(4) > *,
.pay0-pagos-main-table td:nth-child(4) > *,
.pay0-pagos-main-table th:nth-child(5) > *,
.pay0-pagos-main-table td:nth-child(5) > *,
.pay0-pagos-main-table th:nth-child(8) > *,
.pay0-pagos-main-table td:nth-child(8) > *,
.pay0-pagos-main-table th:nth-child(9) > *,
.pay0-pagos-main-table td:nth-child(9) > *,
.pay0-pagos-main-table th:nth-child(10) > *,
.pay0-pagos-main-table td:nth-child(10) > *,
.pay0-pagos-main-table th:nth-child(11) > *,
.pay0-pagos-main-table td:nth-child(11) > *,
.pay0-pagos-main-table th:nth-child(12) > *,
.pay0-pagos-main-table td:nth-child(12) > *,
.pay0-pagos-main-table th:nth-child(13) > *,
.pay0-pagos-main-table td:nth-child(13) > *,
.pay0-pagos-main-table th:nth-child(14) > *,
.pay0-pagos-main-table td:nth-child(14) > *,
.pay0-pagos-main-table th:nth-child(15) > *,
.pay0-pagos-main-table td:nth-child(15) > * {
  margin-left: auto !important;
  margin-right: auto !important;
  text-align: center !important;
  justify-content: center !important;
}

/* Cliente y Empresa: texto real a la izquierda */
.pay0-pagos-main-table td:nth-child(6) > div,
.pay0-pagos-main-table td:nth-child(7) > div {
  display: block !important;
  width: 100% !important;
  margin: 0 !important;
  text-align: left !important;
}

/* Relacion: el circulo vacio necesita display para tener ancho y alto */
.pay0-pagos-main-table td:nth-child(3) [data-payment-relation] {
  display: inline-flex !important;
  width: 100% !important;
  min-width: 0 !important;
  overflow: visible !important;
}

.pay0-pagos-main-table td:nth-child(3) [data-payment-relation] > span {
  overflow: visible !important;
}

/* Pendientes, Docs y Nota */
.pay0-pagos-main-table td:nth-child(11) > div,
.pay0-pagos-main-table td:nth-child(12) > *,
.pay0-pagos-main-table td:nth-child(13) > * {
  width: 100% !important;
  justify-content: center !important;
}

/* Estatus sin minimo historico de 145px */
.pay0-pagos-main-table td:nth-child(14) > span {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
}

/* Acciones visibles, centradas y con espacio util */
.pay0-pagos-main-table td:nth-child(15) > div {
  width: 100% !important;
  justify-content: center !important;
  gap: 3px !important;
  opacity: 1 !important;
  overflow: visible !important;
}

/* H4-D67-A4_PAGOS_CANONICAL_LAYOUT_END */
`;

css = css.trimEnd() + "\n\n" + canonicalCss.trim() + "\n";

const relation = `"use client";

type RelationState = "NONE" | "PARTIAL" | "COMPLETE" | "REVIEW";

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[\\s-]+/g, "_")
    .trim()
    .toUpperCase();
}

function amount(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,\\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function reviewState(payment: any): boolean {
  const token = [
    payment?.relationStatus,
    payment?.relacionStatus,
    payment?.paymentRelationStatus,
    payment?.paymentApplicationStatus,
    payment?.applicationStatus,
    payment?.iqPaymentApplicationStatus,
    payment?.iqApplicationStatus,
    payment?.iqApplicationPlanStatus,
    payment?.paymentApplicationPlanStatus,
  ]
    .map(normalize)
    .filter(Boolean)
    .join("|");

  return /(REVIEW|REVISION|REJECT|RECHAZ|ERROR|FAILED|UNKNOWN|BLOCKED)/.test(
    token,
  );
}

export function resolvePaymentRelationState(payment: any): RelationState {
  if (reviewState(payment)) {
    return "REVIEW";
  }

  const paymentStatus = normalize(payment?.status);
  const total = amount(
    payment?.montoTotal ??
      payment?.monto ??
      payment?.amount,
  );
  const applied = amount(
    payment?.montoAplicado ??
      payment?.totalAplicado ??
      payment?.aplicado ??
      payment?.appliedAmount ??
      payment?.applicationAmount,
  );

  if (
    paymentStatus === "APLICADO_TOTAL" ||
    paymentStatus === "APLICADO_TOTALMENTE" ||
    (total > 0 && applied >= total - 0.01)
  ) {
    return "COMPLETE";
  }

  if (
    paymentStatus === "APLICADO_PARCIAL" ||
    paymentStatus === "PARCIALMENTE_APLICADO" ||
    applied > 0
  ) {
    return "PARTIAL";
  }

  return "NONE";
}

const views: Record<
  RelationState,
  {
    title: string;
    circleClass: string;
    alert: boolean;
  }
> = {
  NONE: {
    title: "Sin relacion",
    circleClass:
      "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-500/80 ring-1 ring-slate-300/30",
    alert: false,
  },
  PARTIAL: {
    title: "Relacion parcial",
    circleClass:
      "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ring-1 ring-amber-200/60",
    alert: false,
  },
  COMPLETE: {
    title: "Relacion completa",
    circleClass:
      "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 ring-1 ring-emerald-200/60",
    alert: false,
  },
  REVIEW: {
    title: "Requiere revision",
    circleClass: "",
    alert: true,
  },
};

export function PaymentRelationIndicator({
  payment,
}: {
  payment: any;
}) {
  const state = resolvePaymentRelationState(payment);
  const view = views[state];

  return (
    <span
      className="inline-flex min-h-6 min-w-6 items-center justify-center"
      title={view.title}
      aria-label={view.title}
      data-payment-relation={state}
    >
      {view.alert ? (
        <span
          className="inline-block text-sm leading-none text-amber-400"
          aria-hidden="true"
        >
          {"\\u26A0"}
        </span>
      ) : (
        <span className={view.circleClass} aria-hidden="true" />
      )}
    </span>
  );
}
`;

fs.writeFileSync(pagePath, page, "utf8");
fs.writeFileSync(cssPath, css, "utf8");
fs.writeFileSync(relationPath, relation, "utf8");

const pageAfter = fs.readFileSync(pagePath, "utf8");
const cssAfter = fs.readFileSync(cssPath, "utf8");
const relationAfter = fs.readFileSync(relationPath, "utf8");

const checks = [
  ["15 colgroup", (pageAfter.match(/<col className=/g) || []).length >= 15],
  ["relation col", pageAfter.includes('className="pay0-col-relacion"')],
  ["relation sort key", pageAfter.includes('{ label: "Relacion", key: "montoAplicado" }')],
  ["colspan 15", (pageAfter.match(/colSpan=\{15\}/g) || []).length === 2],
  ["old colspan gone", !pageAfter.includes("colSpan={14}")],
  ["old useEffect gone", !pageAfter.includes("pay0-pagos-main-table ui canon moved")],
  ["single canonical CSS", (cssAfter.match(/H4-D67-A4_PAGOS_CANONICAL_LAYOUT_BEGIN/g) || []).length === 1],
  ["old 11-col CSS gone", !cssAfter.includes("/* Distribucion canonica de anchos */")],
  ["old A2 CSS gone", !cssAfter.includes("H4-D67-A2_PAGOS_15_COL_LAYOUT_BEGIN")],
  ["relation visible display", relationAfter.includes("inline-block h-2.5 w-2.5")],
  ["actual payment fields", relationAfter.includes("payment?.montoAplicado") && relationAfter.includes("payment?.montoTotal")],
];

for (const [name, ok] of checks) {
  if (!ok) fail(`Validacion fallida: ${name}`);
  console.log(`OK ${name}`);
}

console.log("PATCH_OK H4-D67-A4");
