export default function CompactBalanceCells({ amount, paid, pending, application = false }: { amount: number; paid: number; pending: number; application?: boolean }) {
  const money = (value: number) => Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const settled = pending <= 0 && amount > 0;
  const partial = !settled && paid > 0;
  const state = settled ? (application ? "Aplicado" : "Pagado") : partial ? "Parcial" : (application ? "Disponible" : "Pendiente");
  return <>
    <td className="pay0-td-money pay0-balance-cell text-slate-200"><span className="sr-only">Monto: </span>${money(amount)}</td>
    <td className="pay0-td-money pay0-balance-cell text-emerald-300"><span className="sr-only">{application ? "Aplicado" : "Abonado"}: </span>${money(paid)}</td>
    <td className={`pay0-td-money pay0-balance-cell ${settled ? "text-emerald-300" : "text-amber-200"}`}>
      <span className="sr-only">{application ? "Disponible" : "Pendiente"}: </span>${money(pending)}
      <span className="block font-sans text-[9px] font-normal leading-tight">{state}</span>
    </td>
  </>;
}
