export type MatStatusTone = "ok" | "warn" | "info" | "danger" | "muted";

const toneClass: Record<MatStatusTone, string> = {
  ok: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  warn: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  info: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  danger: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  muted: "border-white/10 bg-white/5 text-slate-300",
};

export function MatStatusPill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: MatStatusTone;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass[tone]}`}>
      {label}
    </span>
  );
}