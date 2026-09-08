import { MatStatusPill, type MatStatusTone } from "./MatStatusPill";

export type MatMovement = {
  id: string;
  title: string;
  caption: string;
  amount: string;
  status: string;
  tone?: MatStatusTone;
};

export function MatMovementList({
  id,
  title,
  items,
  emptyTitle = "Sin datos disponibles",
  emptyCaption = "Conecta desde Telegram para ver informacion real.",
}: {
  id?: string;
  title: string;
  items: MatMovement[];
  emptyTitle?: string;
  emptyCaption?: string;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-[30px] border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-black text-white">{title}</h2>
        <span className="rounded-full border border-white/10 bg-slate-950/40 px-2 py-1 text-[10px] font-bold text-slate-400">
          {items.length} items
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/40 p-5 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-cyan-100">
            P0
          </div>
          <div className="text-sm font-black text-slate-100">{emptyTitle}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{emptyCaption}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <article key={item.id} className="rounded-[24px] border border-white/10 bg-slate-950/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-100">{item.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{item.caption}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-white">{item.amount}</div>
                  <div className="mt-1">
                    <MatStatusPill label={item.status} tone={item.tone || "muted"} />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}