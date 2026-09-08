import { ROLE_DEFAULT_MODULES } from "./authorizationPolicy.generated";

// La política generada conserva explícitamente materialidad y telegram.
export function getDefaultModules(role: "superadmin" | "admin" | "operador") {
  return JSON.parse(JSON.stringify(ROLE_DEFAULT_MODULES[role]));
}
