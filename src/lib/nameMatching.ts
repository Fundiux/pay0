// Tolerant matching of client and company names read from purchase orders and invoices.
// Owner request 2026-11-24: the system must not reject a client over dots, commas or how the legal form is written
// ("SA DE CV" vs "S.A. DE C.V."). A match must still be unique: when two options fit equally, none is chosen.

const LEGAL_FORMS = [
  "sociedad anonima promotora de inversion de capital variable",
  "sociedad anonima de capital variable",
  "sociedad de responsabilidad limitada de capital variable",
  "sociedad de responsabilidad limitada",
  "sociedad civil",
  "asociacion civil",
  "sapi de cv",
  "sa de cv",
  "s de rl de cv",
  "s de rl",
  "sas de cv",
  "sas",
  "sapi",
  "sa",
  "sc",
  "ac",
];

/** Lowercase, no accents, punctuation as spaces, single spaces. */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The name without its legal form, so "Terra Labor S.A. de C.V." and "TERRA LABOR SA DE CV" compare equal. */
export function coreName(value: unknown): string {
  // Joined single letters ("s a de c v") are folded first so dotted forms match the compact ones.
  let name = ` ${normalizeName(value).replace(/\b([a-z]) (?=[a-z]\b)/g, "$1")} `;
  for (const form of LEGAL_FORMS) {
    const compact = form.replace(/ /g, "");
    for (const variant of [form, compact]) {
      if (name.endsWith(` ${variant} `)) name = name.slice(0, name.length - variant.length - 1);
    }
  }
  return name.replace(/\s+/g, " ").trim();
}

type Named = { label?: unknown; value?: unknown };

/** The single option whose name matches the target, tolerating punctuation and legal-form spelling; null when none or ambiguous. */
export function matchOptionByName<T extends Named>(options: T[], target: unknown): T | null {
  const wanted = coreName(target);
  if (wanted.length < 3) return null;
  const tiers: Array<(name: string) => boolean> = [
    (name) => name === wanted,
    (name) => wanted.length >= 4 && name.length >= 4 && (name.includes(wanted) || wanted.includes(name)),
  ];
  for (const fits of tiers) {
    const found = options.filter((option) => fits(coreName(option.label)) || fits(coreName(option.value)));
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}
