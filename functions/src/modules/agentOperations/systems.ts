import { AGENTS } from "./contract";

export type SystemDefinition = {
  id: string; name: string; description: string; status: "ACTIVE" | "PLANNED";
  owner: string; contextNamespace: string; dataNamespace: string; navigation: string | null;
  permissions: string[]; agentIds: string[];
  connections: Array<{ sourceSystemId: string; contractId: string; permissions: string[]; approved: boolean }>;
};

export const SYSTEMS: SystemDefinition[] = [
  { id: "platform", name: "Plataforma Central", description: "Orquestación, propuestas y vigilancia.", status: "ACTIVE", owner: "PAY0", contextNamespace: "platform", dataNamespace: "agentOperations", navigation: "/systems", permissions: ["diagnose", "propose", "observe"], agentIds: ["hugo", "maria", "sofia", "sentinel", "agent-creator"], connections: [] },
  { id: "pay0", name: "PAY0", description: "Operación financiera y expedientes.", status: "ACTIVE", owner: "PAY0", contextNamespace: "pay0", dataNamespace: "roots", navigation: "/", permissions: ["diagnose", "recoverQuotation", "observe"], agentIds: ["iq", "expediente", "pagos", "conciliacion", "documentos", "soporte"], connections: [{ sourceSystemId: "platform", contractId: "platform-pay0-observe-v1", permissions: ["diagnose", "observe"], approved: true }] },
  { id: "assets", name: "Assets", description: "Patrimonio y posiciones.", status: "ACTIVE", owner: "PAY0", contextNamespace: "assets", dataNamespace: "assets", navigation: "/assets", permissions: [], agentIds: [], connections: [] },
  { id: "maria", name: "María", description: "Interfaz de conversación global.", status: "ACTIVE", owner: "PAY0", contextNamespace: "maria", dataNamespace: "agent007", navigation: "/hugo", permissions: [], agentIds: [], connections: [] },
  { id: "apuestas", name: "Apuestas", description: "Sistema futuro; sin conexiones ni permisos.", status: "PLANNED", owner: "PAY0", contextNamespace: "apuestas", dataNamespace: "apuestas", navigation: null, permissions: [], agentIds: [], connections: [] },
  { id: "trading", name: "Trading", description: "Sistema futuro; sin conexiones ni permisos.", status: "PLANNED", owner: "PAY0", contextNamespace: "trading", dataNamespace: "trading", navigation: null, permissions: [], agentIds: [], connections: [] },
];

export function canAgentAccessSystem(agentId: string, systemId: string, permission: string): boolean {
  const agent = AGENTS.find(row => row.id === agentId);
  const system = SYSTEMS.find(row => row.id === systemId);
  if (!agent?.enabled || !system || system.status !== "ACTIVE" || !agent.permissions.includes(permission) || !system.permissions.includes(permission)) return false;
  if (agent.systemId === systemId) return true;
  return system.connections.some(connection => connection.sourceSystemId === agent.systemId && connection.approved && connection.permissions.includes(permission));
}

export const BUSINESS_CELL_ROLES = ["opportunity-explorer", "viability-evaluator", "system-builder", "offer-publisher", "operator", "capital-risk-controller"] as const;
