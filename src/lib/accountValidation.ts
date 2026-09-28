export function normalizeAccountUsername(value: string): string {
  const username = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)) {
    throw new Error("Usa de 3 a 32 caracteres: letras sin acentos, números, punto, guion o guion bajo. Comienza y termina con letra o número.");
  }
  return username;
}

export function validatePasswordChange(current: string, password: string, confirmation: string): void {
  if (!current) throw new Error("Escribe tu contraseña actual.");
  if (password.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  if (password.length > 128) throw new Error("La nueva contraseña no puede superar 128 caracteres.");
  if (password !== confirmation) throw new Error("La confirmación no coincide con la nueva contraseña.");
  if (password === current) throw new Error("Elige una contraseña distinta de la actual.");
}

export function accountErrorMessage(error: any): string {
  const code = String(error?.code || "");
  if (["auth/wrong-password", "auth/invalid-credential", "auth/user-mismatch", "auth/invalid-login-credentials"].includes(code)) return "La contraseña actual no es correcta.";
  if (code === "auth/requires-recent-login") return "Tu sesión necesita confirmación. Vuelve a escribir tu contraseña actual.";
  if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") return "La nueva contraseña no cumple los requisitos de seguridad de la cuenta.";
  if (code === "auth/too-many-requests" || code === "functions/resource-exhausted") return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (code === "auth/network-request-failed") return "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
  if (code === "functions/already-exists") return "Ese nombre de usuario no está disponible.";
  if (code === "auth/user-disabled" || code === "functions/permission-denied") return "Tu cuenta no tiene acceso. Contacta a tu administrador.";
  if (code) return "No se pudo actualizar la cuenta. Inténtalo de nuevo.";
  return error instanceof Error ? error.message : "No se pudo actualizar la cuenta.";
}
