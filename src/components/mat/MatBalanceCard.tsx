import { MatStatusPill, type MatStatusTone } from "./MatStatusPill";

export function MatBalanceCard({
  id,
  title,
  amount,
  subtitle,
  status,
  statusTone = "info",
  rows = [],
}: {
  id?: string;
  title: string;
  amount: string;
  subtitle?: string;
  status?: string;
  statusTone?: MatStatusTone;
  rows?: Array<{ label: string; value: string }>;
}) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.07] shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="relative p-5">
        <div className="absolute right-[-40px] top-[-50px] h-32 w-32 rounded-full bg-cyan-300/10 blur-2xl" />

        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/80">{title}</p>
            <div className="mt-2 text-4xl font-black tracking-tight text-white">{amount}</div>
            {subtitle ? <p className="mt-1 max-w-[220px] text-xs leading-5 text-slate-300">{subtitle}</p> : null}
          </div>

          {status ? <MatStatusPill label={status} tone={statusTone} /> : null}
        </div>

        {rows.length > 0 ? (
          <div className="relative mt-5 grid grid-cols-2 gap-2">
            {rows.map((row) => (
              <div key={row.label} className="rounded-[22px] border border-white/10 bg-slate-950/45 p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{row.label}</div>
                <div className="mt-1 truncate text-sm font-black text-slate-100">{row.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}