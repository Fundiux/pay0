"use client";

import { AgentConnectorsPanel } from "@/components/whatsapp/AgentConnectorsPanel";
import { GroupClientAssignment } from "@/components/whatsapp/GroupClientAssignment";
import { DeliveryHistory } from "@/components/whatsapp/DeliveryHistory";

export default function WhatsAppPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 text-slate-100">
      <div>
        <h1 className="text-2xl font-bold">WhatsApp</h1>
        <p className="mt-1 text-sm text-slate-400">Conexión de los agentes y grupos que observan.</p>
      </div>

      <AgentConnectorsPanel />

      <GroupClientAssignment />

      <DeliveryHistory />
    </div>
  );
}
