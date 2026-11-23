# Contrato de distribución por cliente y cuentas propias (WIP)

Estado: diseño de migración; NO habilitar ejecución ni sustituir reglas existentes hasta completar backend, UI y pruebas.

## Separación de responsabilidades
- Perfil del usuario: catálogo personal de cuentas destino (una o varias), altas/edición/desactivación, titularidad y validación IQ. Nunca modifica comisiones.
- Clientes > Costos: para cada participante, seleccionar únicamente cuentas activas y verificadas del catálogo de ese usuario; guardar instrucciones por cliente.
- Cada instrucción tiene exactamente uno de `pointsBps` (puntos porcentuales sobre la base contractual comparable) o `earningsPercentBps` (porcentaje de la utilidad efectivamente contabilizada), nunca ambos. Mostrar columnas separadas **Puntos** y **% de comisión**; no mostrar ejemplos, simulaciones ni montos en pesos.
- La suma monetaria de instrucciones para cada movimiento no puede superar la utilidad contabilizada del participante. No forzar 100%: el remanente sigue disponible, sin transferencia.
- Configuración versionada y prospectiva: el movimiento conserva snapshot de versión, cuentas, base de cálculo y redondeo. No recalcular movimientos previos al editar reglas o cuentas.
- Cuenta desactivada, sin validación IQ vigente, ambigua, o de otro titular: bloquear preparación/envío; no sustituirla silenciosamente.
- Idempotencia por movimiento, titular, versión y destino; los estados inciertos requieren conciliación, nunca reintento financiero ciego.

## Hallazgos del código actual
- `src/components/ClientCommissionRulePanel.tsx` contiene reglas de cliente ligadas a `beneficiaryId/methodId` del cliente.
- `src/components/CommissionUserAssignments.tsx` asigna instrumentos por cliente y usuario.
- `src/components/UserCommissionDestinations.tsx` deja elegir distribución por cliente desde Mi cuenta y presenta una simulación; esa responsabilidad se debe trasladar a Costos.
- `functions/src/modules/commissionDistributions/domain.ts` exige suma total de 100% o de puntos contractuales, por lo que hoy no soporta correctamente dispersiones parciales mixtas. `allocateMinorExactly` normaliza pesos al total y no debe usarse directamente para las nuevas instrucciones parciales.
- Mantener motor legacy intacto mientras se implementa y prueba la ruta nueva.

## Pruebas obligatorias
- 0.20 puntos versus 50% de la utilidad; mezcla de modalidades, múltiples cuentas y reparto parcial.
- Diferente base TOTAL/SUBTOTAL, utilidad nula, costo fijo/no comparable, redondeo de centavos y exceso de utilidad.
- Aislamiento por rootId/uid, acceso a cuentas de otros usuarios, duplicados, baja de cuenta, verificación IQ obsoleta.
- Snapshot histórico, cambios concurrentes, reservas, fallo/resultado incierto IQ y no duplicación.

## Decisión de visualización y almacenamiento (23-nov-2026)
- Mostrar banco, beneficiario y número completo de CLABE o tarjeta a usuarios autorizados para verificar visualmente el destino.
- Guardar el número bancario **únicamente cifrado** en `personalCommissionAccounts.encryptedInstrument` con AES-256-GCM, AAD por raíz/titular/cuenta y clave administrada `COMMISSION_ACCOUNT_ENCRYPTION_KEY`. El número completo solo se revela al titular autorizado y se descifra en memoria para la validación IQ y el ejecutor autorizado; jamás se almacena en los espejos cliente.
- Firestore utiliza cifrado en reposo y en tránsito; es una capa adicional, no sustituto del cifrado de aplicación, controles de acceso por raíz/titular ni auditoría de lecturas y escrituras.
- La coincidencia IQ exige número bancario completo comprobado, perfil, cliente, origen (despacho), identificadores del beneficiario y cuenta y verificación reciente. La vista previa y publicación fallan cerradas si faltan o difieren; el resultado no autoriza por sí mismo pagos.
- El secreto y la integración Auth/Functions/Firestore/IQ deben verificarse en el entorno destino antes de cualquier autorización de despliegue.
- Nunca publicar cuentas en logs, URLs o respuestas accesibles a terceros. Mantener validación de IQ y controles contra transferencias duplicadas.
- Auditoría de secretos/credenciales de IQ queda fuera de este alcance, para revisión posterior.
