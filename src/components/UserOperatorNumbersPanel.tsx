"use client";

import { useEffect, useState } from "react";
import { Phone, Plus, Trash2 } from "lucide-react";
import { getUserOperatorNumbers, saveUserOperatorNumbers } from "@/services/users";

type Props = { targetUid: string; onClose?: () => void };

// Se muestra el número a 10 dígitos; se guarda con lada 52 y sin nombre.
const toDisplay = (value: string) => (/^52\d{10}$/.test(value) ? value.slice(2) : value);

export default function UserOperatorNumbersPanel({ targetUid, onClose }: Props) {
  const [rows, setRows] = useState<string[]>([]);
  const [max, setMax] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getUserOperatorNumbers(targetUid)
      .then(res => { if (alive) { setRows((res?.numbers || []).map(toDisplay)); setMax(res?.max || 20); } })
      .catch((e: any) => { if (alive) setMsg(`No se pudieron cargar los números: ${e?.message || e}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [targetUid]);

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const res = await saveUserOperatorNumbers(targetUid, rows.filter(row => row.trim()));
      setRows((res?.numbers || []).map(toDisplay));
      setMsg("Números guardados.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudieron guardar los números.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Números de atención a clientes de este usuario. Solo se guarda el número, sin nombre. En los grupos, un número que no esté en la lista de un usuario se toma como cliente.
      </p>
      {loading ? <p className="text-sm text-slate-400">Cargando...</p> : (
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-slate-500">Todavía no hay números.</p>}
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Phone size={16} className="shrink-0 text-slate-400" aria-hidden />
              <span className="w-6 shrink-0 text-xs text-slate-500">{index + 1})</span>
              <input
                value={row}
                inputMode="tel"
                maxLength={20}
                placeholder="10 dígitos"
                onChange={event => setRows(rows.map((value, i) => (i === index ? event.target.value : value)))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
              <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== index))} title="Quitar número" aria-label="Quitar número" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-rose-400/50 hover:text-rose-200">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={loading || rows.length >= max} onClick={() => setRows([...rows, ""])} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-sky-400/50 disabled:opacity-50">
          <Plus size={15} /> Nuevo
        </button>
        <button type="button" disabled={loading || saving} onClick={() => void save()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
          {saving ? "Guardando..." : "Guardar"}
        </button>
        {onClose && <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Cerrar</button>}
        {msg && <span className="text-sm text-slate-200">{msg}</span>}
      </div>
    </div>
  );
}
