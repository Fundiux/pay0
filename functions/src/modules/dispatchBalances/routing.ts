import {
  H4_D82_A3_CROSS_DISPATCH_TRANSFER_ALLOWED,
  H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
  type DispatchSplitPolicy,
} from "./contract";
import {
  buildDispersionLegKey,
  normalizeDispatchBalanceCurrency,
  type DispatchRouteCandidate,
  type DispatchRouteLeg,
  type DispatchRoutePlan,
} from "./domain";

const CENTS = 100;

function toCents(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Monto no finito.");
  }

  return Math.round(
    (value + Number.EPSILON) * CENTS,
  );
}

function fromCents(value: number) {
  return Math.round(value) / CENTS;
}

function nonNegativeCents(
  value: number,
  label: string,
) {
  const cents = toCents(value);

  if (cents < 0) {
    throw new Error(
      `${label} no puede ser negativo.`,
    );
  }

  return cents;
}

function stableCandidateSort(
  left: DispatchRouteCandidate,
  right: DispatchRouteCandidate,
) {
  const priorityLeft = Number.isFinite(
    Number(left.priority),
  )
    ? Number(left.priority)
    : Number.MAX_SAFE_INTEGER;
  const priorityRight = Number.isFinite(
    Number(right.priority),
  )
    ? Number(right.priority)
    : Number.MAX_SAFE_INTEGER;

  if (priorityLeft !== priorityRight) {
    return priorityLeft - priorityRight;
  }

  const costLeft = Number.isFinite(
    Number(left.operationalCostAmount),
  )
    ? Number(left.operationalCostAmount)
    : Number.MAX_SAFE_INTEGER;
  const costRight = Number.isFinite(
    Number(right.operationalCostAmount),
  )
    ? Number(right.operationalCostAmount)
    : Number.MAX_SAFE_INTEGER;

  if (costLeft !== costRight) {
    return costLeft - costRight;
  }

  if (
    left.availableBalance !==
    right.availableBalance
  ) {
    return (
      right.availableBalance -
      left.availableBalance
    );
  }

  return String(left.despachoId).localeCompare(
    String(right.despachoId),
  );
}

function buildLegsFromDebitAllocation(
  params: {
    principalDispersionId: string;
    requestedCents: number;
    totalCommissionCents: number;
    currency: string;
    allocations: Array<{
      candidate: DispatchRouteCandidate;
      debitCents: number;
    }>;
  },
): DispatchRouteLeg[] {
  const totalDebitCents =
    params.requestedCents +
    params.totalCommissionCents;

  if (totalDebitCents <= 0) {
    return [];
  }

  const rawPrincipal = params.allocations.map(
    (item) => {
      const numerator =
        params.requestedCents *
        item.debitCents;
      const floor = Math.floor(
        numerator / totalDebitCents,
      );
      const remainder =
        numerator % totalDebitCents;

      return {
        ...item,
        principalCents: floor,
        remainder,
      };
    },
  );

  let principalAssigned = rawPrincipal.reduce(
    (sum, item) =>
      sum + item.principalCents,
    0,
  );
  let principalRemainder =
    params.requestedCents -
    principalAssigned;

  const remainderOrder = rawPrincipal
    .map((item, index) => ({
      index,
      remainder: item.remainder,
      despachoId:
        item.candidate.despachoId,
    }))
    .sort(
      (left, right) =>
        right.remainder -
          left.remainder ||
        left.despachoId.localeCompare(
          right.despachoId,
        ),
    );

  let cursor = 0;

  while (principalRemainder > 0) {
    const target =
      remainderOrder[
        cursor %
          remainderOrder.length
      ];

    rawPrincipal[
      target.index
    ].principalCents += 1;
    principalRemainder -= 1;
    principalAssigned += 1;
    cursor += 1;
  }

  if (
    principalAssigned !==
    params.requestedCents
  ) {
    throw new Error(
      "No se pudo distribuir el principal.",
    );
  }

  return rawPrincipal.map(
    (item, index) => {
      const commissionCents =
        item.debitCents -
        item.principalCents;

      if (
        item.principalCents < 0 ||
        commissionCents < 0
      ) {
        throw new Error(
          "Distribucion de tramo invalida.",
        );
      }

      const availableCents =
        nonNegativeCents(
          item.candidate
            .availableBalance,
          "availableBalance",
        );

      if (
        item.debitCents >
        availableCents
      ) {
        throw new Error(
          "El tramo excede el saldo del despacho.",
        );
      }

      return {
        legIndex: index + 1,
        legKey: buildDispersionLegKey(
          params.principalDispersionId,
          item.candidate.despachoId,
          index + 1,
        ),
        despachoId:
          item.candidate.despachoId,
        despachoName:
          item.candidate
            .despachoName || null,
        currency:
          normalizeDispatchBalanceCurrency(
            params.currency,
          ),
        principalAmount:
          fromCents(
            item.principalCents,
          ),
        clientCommissionAmount:
          fromCents(
            commissionCents,
          ),
        totalDebitAmount:
          fromCents(item.debitCents),
        availableBalanceBefore:
          fromCents(availableCents),
        availableBalanceAfterReservation:
          fromCents(
            availableCents -
              item.debitCents,
          ),
        operationalCostAmount:
          Number(
            item.candidate
              .operationalCostAmount ||
              0,
          ),
        channel:
          item.candidate.channel ||
          null,
      };
    },
  );
}

export function planDispatchRoute(
  input: {
    principalDispersionId: string;
    requestedAmount: number;
    clientCommissionAmount: number;
    currency?: string | null;
    splitPolicy: DispatchSplitPolicy;
    candidates: DispatchRouteCandidate[];
  },
): DispatchRoutePlan {
  if (
    H4_D82_A3_CROSS_DISPATCH_TRANSFER_ALLOWED
  ) {
    throw new Error(
      "El contrato no permite transferencias entre despachos.",
    );
  }

  const requestedCents =
    nonNegativeCents(
      input.requestedAmount,
      "requestedAmount",
    );
  const commissionCents =
    nonNegativeCents(
      input.clientCommissionAmount,
      "clientCommissionAmount",
    );
  const totalDebitCents =
    requestedCents +
    commissionCents;
  const currency =
    normalizeDispatchBalanceCurrency(
      input.currency || "MXN",
    );

  if (requestedCents <= 0) {
    throw new Error(
      "requestedAmount debe ser mayor a cero.",
    );
  }

  const eligible = input.candidates
    .filter(
      (candidate) =>
        candidate.eligible === true &&
        String(
          candidate.currency ||
            currency,
        )
          .trim()
          .toUpperCase() === currency &&
        toCents(
          candidate.availableBalance,
        ) > 0,
    )
    .sort(stableCandidateSort);

  const eligibleBalanceCents =
    eligible.reduce(
      (sum, candidate) =>
        sum +
        nonNegativeCents(
          candidate.availableBalance,
          "availableBalance",
        ),
      0,
    );

  const base = {
    version:
      H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
    splitPolicy: input.splitPolicy,
    requestedAmount:
      fromCents(requestedCents),
    clientCommissionAmount:
      fromCents(commissionCents),
    totalDebitAmount:
      fromCents(totalDebitCents),
    currency,
    eligibleBalanceTotal:
      fromCents(
        eligibleBalanceCents,
      ),
  };

  if (eligible.length === 0) {
    return {
      ...base,
      status:
        "NO_ELIGIBLE_DISPATCH",
      legs: [],
      selectedDispatchCount: 0,
      reason:
        "No existe un despacho elegible.",
    };
  }

  const single = eligible.find(
    (candidate) =>
      toCents(
        candidate.availableBalance,
      ) >= totalDebitCents,
  );

  if (single) {
    const legs =
      buildLegsFromDebitAllocation({
        principalDispersionId:
          input.principalDispersionId,
        requestedCents,
        totalCommissionCents:
          commissionCents,
        currency,
        allocations: [
          {
            candidate: single,
            debitCents:
              totalDebitCents,
          },
        ],
      });

    return {
      ...base,
      status: "READY_SINGLE",
      legs,
      selectedDispatchCount: 1,
      reason: null,
    };
  }

  if (
    eligibleBalanceCents <
    totalDebitCents
  ) {
    return {
      ...base,
      status:
        "INSUFFICIENT_EXECUTABLE_BALANCE",
      legs: [],
      selectedDispatchCount: 0,
      reason:
        "El saldo ejecutable de los despachos elegibles no cubre monto y comision.",
    };
  }

  if (
    input.splitPolicy ===
    "SINGLE_DISPATCH"
  ) {
    return {
      ...base,
      status:
        "INSUFFICIENT_EXECUTABLE_BALANCE",
      legs: [],
      selectedDispatchCount: 0,
      reason:
        "La politica exige un solo despacho y ninguno cubre el total.",
    };
  }

  if (
    input.splitPolicy ===
    "REVIEW_REQUIRED"
  ) {
    return {
      ...base,
      status: "REVIEW_REQUIRED",
      legs: [],
      selectedDispatchCount: 0,
      reason:
        "La operacion requiere division entre despachos y el tipo exige revision.",
    };
  }

  let pendingDebitCents =
    totalDebitCents;
  const allocations: Array<{
    candidate: DispatchRouteCandidate;
    debitCents: number;
  }> = [];

  for (const candidate of eligible) {
    if (pendingDebitCents <= 0) {
      break;
    }

    const availableCents =
      nonNegativeCents(
        candidate.availableBalance,
        "availableBalance",
      );
    const debitCents = Math.min(
      pendingDebitCents,
      availableCents,
    );

    if (debitCents <= 0) {
      continue;
    }

    allocations.push({
      candidate,
      debitCents,
    });
    pendingDebitCents -=
      debitCents;
  }

  if (pendingDebitCents !== 0) {
    throw new Error(
      "El planificador no pudo cubrir el total pese a tener saldo suficiente.",
    );
  }

  const legs =
    buildLegsFromDebitAllocation({
      principalDispersionId:
        input.principalDispersionId,
      requestedCents,
      totalCommissionCents:
        commissionCents,
      currency,
      allocations,
    });

  return {
    ...base,
    status: "READY_SPLIT",
    legs,
    selectedDispatchCount:
      legs.length,
    reason: null,
  };
}