export type HugoTeamAgent = "hugo" | "maria" | "sofia" | "sentinel";
export const TEAM_AGENTS: ReadonlyArray<{ id: HugoTeamAgent; name: string; role: string }> = [
  { id: "hugo", name: "Hugo", role: "Coordinador" },
  { id: "maria", name: "María", role: "Operación PAY0" },
  { id: "sofia", name: "Sofía", role: "Documentos y cotizaciones" },
  { id: "sentinel", name: "Sentinel", role: "Diagnóstico de seguridad" },
];
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const named = (message: string): HugoTeamAgent | null => {
  const text = normalize(message);
  const handoff = /\b(pasame|preguntale|hablar|consulta|dirigete)\b.{0,35}\b(maria|sofia|sentinel)\b/.exec(text);
  if (handoff) return handoff[2] as HugoTeamAgent;
  if (/\b(regresa|volver|vuelve|pasame|hablar)\b.{0,28}\bhugo\b/.test(text)) return "hugo";
  if (/\b(maria|sofia|sentinel)\b/.test(text)) return /\bsentinel\b/.test(text) ? "sentinel" : /\bsofia\b/.test(text) ? "sofia" : "maria";
  if (/^hugo\b/.test(text)) return "hugo";
  return null;
};
export function routeTeamTurn(message: string, selected: HugoTeamAgent = "hugo") {
  const direct = named(message);
  const agent = direct || selected;
  const text = normalize(message);
  const consulted: HugoTeamAgent[] = agent === "hugo" && /\b(cotizaci[oó]n|oc|xml|documento|pdf)\b/.test(text) ? ["sofia", "maria"]
    : agent === "hugo" && /\b(incidente|alerta|seguridad)\b/.test(text) ? ["sentinel"]
    : agent === "hugo" && /\b(pendientes?|errores?|reportes?|operacion)\b/.test(text) ? ["maria"] : [agent];
  const writeIntent = /\b(crea|crear|genera|generar|corrige|corregir|modifica|modificar|actualiza|actualizar|cambia|cambiar|elimina|eliminar|borra|borrar|paga|pagar|dispersa|dispersar|facturar|envia|enviar|reintenta|reintentar|publica|publicar|recupera|recuperar|procesa|procesar|sube|subir|aprueba|aprobar|ejecuta|ejecutar|haz|hace)\b/.test(text);
  return { agent, consulted, writeIntent, explicitAgent: direct !== null };
}

export function assertTeamReadOnly(message: string, channel: "TEXT" | "AUDIO") {
  const route = routeTeamTurn(message);
  if (!route.writeIntent) return null;
  return channel === "AUDIO"
    ? "Transcribí una instrucción operativa. Revísala en texto y confirma el alcance antes de cualquier cambio. Esta conversación de voz no ejecutó acciones."
    : "Esta acción requiere una vista previa concreta y una autorización de ejecución. No realicé cambios.";
}
