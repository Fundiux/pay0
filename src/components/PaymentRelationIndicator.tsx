"use client";

// H4-D67-A5_INLINE_RELATION_INDICATOR

type RelationState = "NONE" | "PARTIAL" | "COMPLETE" | "REVIEW";

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_")
    .trim()
    .toUpperCase();
}

function amount(value: unknown): number {
  const parsed = Number(
    String(value ?? "").replace(/[$,\s]/g, ""),
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function hasReviewState(payment: any): boolean {
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

export function resolvePaymentRelationState(
  payment: any,
): RelationState {
  if (hasReviewState(payment)) {
    return "REVIEW";
  }

  const status = normalize(payment?.status);

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
    status === "APLICADO_TOTAL" ||
    status === "APLICADO_TOTALMENTE" ||
    (total > 0 && applied >= total - 0.01)
  ) {
    return "COMPLETE";
  }

  if (
    status === "APLICADO_PARCIAL" ||
    status === "PARCIALMENTE_APLICADO" ||
    applied > 0
  ) {
    return "PARTIAL";
  }

  return "NONE";
}

const stateView: Record<
  RelationState,
  {
    title: string;
    color: string;
    borderColor: string;
    alert: boolean;
  }
> = {
  NONE: {
    title: "Sin relacion",
    color: "#64748b",
    borderColor: "rgba(203, 213, 225, 0.45)",
    alert: false,
  },
  PARTIAL: {
    title: "Relacion parcial",
    color: "#fbbf24",
    borderColor: "rgba(253, 230, 138, 0.75)",
    alert: false,
  },
  COMPLETE: {
    title: "Relacion completa",
    color: "#34d399",
    borderColor: "rgba(167, 243, 208, 0.75)",
    alert: false,
  },
  REVIEW: {
    title: "Requiere revision",
    color: "#fbbf24",
    borderColor: "transparent",
    alert: true,
  },
};

export function PaymentRelationIndicator({
  payment,
}: {
  payment: any;
}) {
  const state = resolvePaymentRelationState(payment);
  const view = stateView[state];

  return (
    <span
      title={view.title}
      aria-label={view.title}
      data-payment-relation={state}
      style={{
        display: "inline-flex",
        width: "100%",
        minWidth: 0,
        height: 24,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    >
      {view.alert ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            color: view.color,
            fontSize: 14,
            lineHeight: 1,
            overflow: "visible",
          }}
        >
          {"\u26A0"}
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            minWidth: 10,
            height: 10,
            minHeight: 10,
            flex: "0 0 10px",
            borderRadius: "9999px",
            backgroundColor: view.color,
            border: `1px solid ${view.borderColor}`,
            boxShadow: `0 0 0 1px ${view.borderColor}`,
            overflow: "visible",
          }}
        />
      )}
    </span>
  );
}