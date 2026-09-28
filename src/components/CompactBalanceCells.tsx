export default function CompactBalanceCells({ amount, paid, pending, application = false }: { amount: number; paid: number; pending: number; application?: boolean }) {
  const money = (value: number) => Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const settled = pending <= 0 && amount > 0;
  return <>
    <td className="pay0-td-money pay0-balance-cell text-slate-200"><span className="sr-only">Monto: </span>${money(amount)}</td>
    <td className="pay0-td-money pay0-balance-cell text-emerald-400"><span className="sr-only">{application ? "Aplicado" : "Abonado"}: </span>${money(paid)}</td>
    <td className={`pay0-td-money pay0-balance-cell ${settled ? "text-emerald-400" : "text-amber-400"}`}>
      <span className="sr-only">{application ? "Disponible" : "Pendiente"}: </span>${money(pending)}
    </td>
  </>;
}
