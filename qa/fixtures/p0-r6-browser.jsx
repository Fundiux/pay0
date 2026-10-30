import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { collection, doc, getDoc, getDocs, query, orderBy, limit, where, setDoc, Timestamp, disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import { useLiveOperationRows } from '@/lib/useLiveOperationRows';
import { recordCreatorLabel } from '@/lib/recordCreator';
import { operationDiscoverySeed } from '@/lib/liveOperationRows';
import Account from '@/app/cuenta/page';
import Corporate from '@/app/administracion/recursos-corporativos/page';
import Evaluation from '@/app/hugo/evaluation/page';
import ActivityLog from '@/components/ActivityLog';
import { canAccessRoutePath } from '@/lib/roles';
const params = new URLSearchParams(location.search);
const kind = params.get('kind') || 'pagos';
function LiveTable() {
  const [rows, setRows] = useState([]), [seed, setSeed] = useState(null), [error, setError] = useState('');
  const [creator, setCreator] = useState('selected'), [filter, setFilter] = useState(''), [selected, setSelected] = useState('');
  const scopeKey = `r:u:${kind}:${creator}`;
  const scope = { uid: 'u', rootId: 'r', role: 'superadmin', fromMillis: 0, toMillis: 1000000, creatorUid: creator };
  useEffect(() => {
    let live = true;
    setRows([]);
    const constraints = [where('rootId', '==', 'r'), orderBy('createdAt', 'desc'), limit(2)];
    if (creator) constraints.push(where('createdBy', '==', creator));
    getDocs(query(collection(db, kind), ...constraints)).then(s => { if (live) { const items = s.docs.map(d => ({ ...d.data(), id: d.id })); setRows(items); setSeed(operationDiscoverySeed(scopeKey, items)); } });
    return () => { live = false; };
  }, [scopeKey]);
  useLiveOperationRows({ collectionName: kind, scopeKey, scope, discovery: seed, rows, setRows, enabled: true, onError: setError });
  useEffect(() => { window.uiTest = { offline: () => disableNetwork(db), online: () => enableNetwork(db), create: async id => setDoc(doc(db, kind, id), { rootId: 'r', createdBy: 'selected', createdByDisplayName: 'Synthetic Creator', status: 'QUEUED', createdAt: Timestamp.fromMillis(5000) }) }; }, []);
  return <main><input aria-label="Filtro" value={filter} onChange={e => setFilter(e.target.value)}/><select aria-label="Creador" value={creator} onChange={e => setCreator(e.target.value)}><option value="selected">Seleccionado</option><option value="other">Otro</option></select>
    <button onClick={async () => { const s = await getDoc(doc(db, kind, 'older')); setRows(current => current.some(r => r.id === s.id) ? current : [...current, { ...s.data(), id: s.id }]); }}>Cargar otra página</button>
    <span role="alert">{error}</span><output>{selected}</output>
    <table><tbody>{rows.filter(r => r.id.includes(filter)).map(row => <tr key={row.id} data-row={row.id}><td><input aria-label={`Seleccionar ${row.id}`} type="checkbox" checked={selected === row.id} onChange={() => setSelected(row.id)}/></td><td>{row.id}</td><td data-creator>{recordCreatorLabel(row)}</td><td>{row.status}</td><td data-visibility>{row.oculto ? "Oculta" : "Visible"}</td><td>{row.pagoIqFolio || row.solicitudIqFolio}</td></tr>)}</tbody></table></main>;
}
const route = params.get('route');
let view = <LiveTable/>;
if (route) {
  const allowed = canAccessRoutePath(window.__profile, route);
  view = !allowed ? <p>Acceso denegado</p> : route === '/cuenta' ? <Account/> : route === '/administracion/recursos-corporativos' ? <Corporate/> : route === '/hugo/evaluation' ? <Evaluation/> : <ActivityLog/>;
}
createRoot(document.getElementById('root')).render(view);
