"use client";

export type MatQuickAction = {
  label: string;
  caption: string;
  icon: string;
  targetId?: string;
  disabled?: boolean;
};

function scrollToTarget(targetId?: string) {
  if (!targetId || typeof window === "undefined") return;

  const target = document.getElementById(targetId);
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "start" });

  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `#${targetId}`);
  } else {
    window.location.hash = targetId;
  }
}

export function MatQuickActions({
  id,
  actions,
}: {
  id?: string;
  actions: MatQuickAction[];
}) {
  return (
    <section id={id} className="grid scroll-mt-4 grid-cols-2 gap-3">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={action.disabled}
          onClick={() => scrollToTarget(action.targetId)}
          className="group rounded-[28px] border border-white/10 bg-white/[0.06] p-4 text-left shadow-xl shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
          title={action.disabled ? "Disponible despues" : action.label}
        >
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[20px] border border-cyan-300/15 bg-cyan-300/10 text-base font-black text-cyan-100 transition group-hover:bg-cyan-300 group-hover:text-slate-950">
            {action.icon}
          </div>
          <div className="text-sm font-black text-white">{action.label}</div>
          <div className="mt-1 text-xs leading-4 text-slate-400">{action.caption}</div>
        </button>
      ))}
    </section>
  );
}