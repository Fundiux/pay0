export type IqReadOnlyDecisionReason =
  | "AUTH_LOGIN"
  | "READ_ONLY_METHOD"
  | "BLOCKED_PAYMENT_APPLICATION_WRITE"
  | "BLOCKED_WRITE_METHOD";

export type IqReadOnlyDecision = {
  allowed: boolean;
  reason: IqReadOnlyDecisionReason;
};

export type IqDiagnosticSelectionMethod =
  | "LABEL_OPTION"
  | "KEYBOARD_FILTER"
  | "VISIBLE_FOLIO_CLICK";

export type IqPaymentApplicationDiagnosticInput<TInput extends object> =
  TInput & {
    submit: false;
    diagnosticOnly: true;
    selectionMethod: IqDiagnosticSelectionMethod;
  };

export type IqPaymentApplicationDiagnosticRunner<
  TInput extends object,
  TResult,
> = (
  input: IqPaymentApplicationDiagnosticInput<TInput>,
) => Promise<TResult>;

function normalizeIqPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return String(rawUrl || "")
      .split("?")[0]
      .replace(/\/+$/, "") || "/";
  }
}

export function decideIqReadOnlyRequest(
  methodInput: string,
  urlInput: string,
): IqReadOnlyDecision {
  const method = String(methodInput || "").trim().toUpperCase();
  const path = normalizeIqPath(urlInput);

  if (method === "POST" && path === "/users/sessions") {
    return {
      allowed: true,
      reason: "AUTH_LOGIN",
    };
  }

  const isPaymentApplicationsPath =
    path === "/payment-applications" ||
    path.startsWith("/payment-applications/");

  if (isPaymentApplicationsPath) {
    if (
      method === "GET" ||
      method === "HEAD" ||
      method === "OPTIONS"
    ) {
      return {
        allowed: true,
        reason: "READ_ONLY_METHOD",
      };
    }

    return {
      allowed: false,
      reason: "BLOCKED_PAYMENT_APPLICATION_WRITE",
    };
  }

  if (
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return {
      allowed: true,
      reason: "READ_ONLY_METHOD",
    };
  }

  return {
    allowed: false,
    reason: "BLOCKED_WRITE_METHOD",
  };
}

export const IQ_PAYMENT_APPLICATION_DIAGNOSTIC_GUARD = Object.freeze({
  submit: false as const,
  diagnosticOnly: true as const,
});

export async function runIqPaymentApplicationReadOnlyDiagnostic<
  TInput extends object,
  TResult,
>(params: {
  input: TInput;
  selectionMethod: IqDiagnosticSelectionMethod;
  runner: IqPaymentApplicationDiagnosticRunner<TInput, TResult>;
}): Promise<TResult> {
  const guardedInput: IqPaymentApplicationDiagnosticInput<TInput> = {
    ...params.input,
    ...IQ_PAYMENT_APPLICATION_DIAGNOSTIC_GUARD,
    selectionMethod: params.selectionMethod,
  };

  return params.runner(guardedInput);
}

export function assertIqReadOnlyRequestAllowed(
  methodInput: string,
  urlInput: string,
): IqReadOnlyDecision {
  const decision = decideIqReadOnlyRequest(methodInput, urlInput);

  if (!decision.allowed) {
    throw new Error(
      `IQ_READ_ONLY_GUARD_BLOCKED:${decision.reason}`,
    );
  }

  return decision;
}