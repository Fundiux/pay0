import { getFunctions, httpsCallable } from "firebase/functions";
import app from "@/lib/firebase";

const functions = getFunctions(app, "us-central1");

export type WhatsAppAutomationState = {
  enabled: boolean;
  configured: boolean;
  effectiveReady: boolean;

  connector: {
    id: string;
    status: string;
    rawStatus: string;
    connected: boolean;
    heartbeatFresh: boolean;
    heartbeatAgeSeconds: number | null;
    lastHeartbeatAt: string | null;
    phoneLabel: string | null;
    authClientId: string | null;
    chatsCount: number;
    sendEnabled: boolean;
    lastChatsSyncedAt: string | null;
    lastSeenAt: string | null;
    error: string | null;
  };

  updatedAt: string | null;
  updatedBy: string | null;
};

type WhatsAppAutomationCallableResult = {
  ok: boolean;
  data: WhatsAppAutomationState;
  message: string;
};

export async function getWhatsAppAutomationConfig(): Promise<{
  data: WhatsAppAutomationState;
  message: string;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    WhatsAppAutomationCallableResult
  >(
    functions,
    "getWhatsAppAutomationConfig",
  );

  const result = await callable({});

  if (!result.data?.data) {
    throw new Error(
      result.data?.message ||
        "No se pudo cargar la automatizacion WhatsApp.",
    );
  }

  return {
    data: result.data.data,
    message: result.data.message || "",
  };
}

export async function setWhatsAppAutomationEnabled(
  enabled: boolean,
): Promise<{
  data: WhatsAppAutomationState;
  message: string;
}> {
  const callable = httpsCallable<
    { enabled: boolean },
    WhatsAppAutomationCallableResult
  >(
    functions,
    "setWhatsAppAutomationEnabled",
  );

  const result = await callable({ enabled });

  if (!result.data?.data) {
    throw new Error(
      result.data?.message ||
        "No se pudo actualizar la automatizacion WhatsApp.",
    );
  }

  return {
    data: result.data.data,
    message: result.data.message || "",
  };
}
