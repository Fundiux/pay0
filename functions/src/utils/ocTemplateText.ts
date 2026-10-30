/**
 * The OC Excel template carries filling instructions in the column next to
 * each field ("* Obligatorio (Cliente, tal como aparece en la CIF)",
 * "Opcional (Nosotros lo validamos ...)"). They are never part of the value.
 */
const HELP_TEXT = /\s*(?:\*\s*)?\b(?:obligatorio|opcional)\b[\s\S]*$/i;

export function isOcTemplateHelp(cell: unknown): boolean {
  const text = String(cell ?? "").trim();
  return /^\*/.test(text) || /^(obligatorio|opcional)\b/i.test(text);
}

/** Removes template instructions that were stored glued to a value. */
export function stripOcTemplateHelp(value: unknown): string {
  return String(value ?? "").replace(HELP_TEXT, "").replace(/\s+/g, " ").trim();
}
