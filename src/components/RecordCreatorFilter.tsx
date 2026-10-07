import type { RecordCreatorOption } from "@/lib/recordCreator";

export default function RecordCreatorFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: RecordCreatorOption[] }) {
  return <label className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
    Usuario
    <select aria-label="Filtrar por usuario creador" value={value} onChange={event => onChange(event.target.value)} className="h-9 min-w-0 max-w-full rounded-xl border border-white/10 bg-[#161d2b] px-3 text-xs text-slate-200 outline-none focus:border-sky-400/60">
      <option value="">Todos los usuarios</option>
      {options.map(person => <option key={person.uid} value={person.uid}>{person.displayName || person.username}{person.displayName && person.username && person.displayName !== person.username ? ` · ${person.username}` : ""}</option>)}
    </select>
  </label>;
}
