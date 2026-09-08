export const SPEI_RETURN_CAUSES = [
  { code: "01", label: "Cuenta inexistente" },
  { code: "02", label: "Cuenta bloqueada" },
  { code: "03", label: "Cuenta cancelada" },
  { code: "05", label: "Cuenta en otra divisa" },
  { code: "06", label: "Cuenta no pertenece al Participante Receptor" },
  { code: "14", label: "Falta informacion mandatoria para completar el pago" },
  { code: "15", label: "Tipo de pago erroneo" },
  { code: "16", label: "Tipo de operacion erronea" },
  { code: "17", label: "Tipo de cuenta no corresponde" },
  { code: "19", label: "Caracter invalido" },
  { code: "20", label: "Excede el limite de saldo autorizado de la cuenta" },
  { code: "21", label: "Excede el limite de abonos permitidos en el mes en la cuenta" },
  { code: "22", label: "Numero de linea de telefonia movil no registrado" },
  { code: "23", label: "Cuenta adicional no recibe pagos que no proceden de Banxico" },
  { code: "24", label: "Estructura de la informacion adicional incorrecta" },
  { code: "25", label: "Falta instruccion para dispersar recursos de clientes por alcanzar limite al saldo" },
  { code: "26", label: "Resolucion resultante del Convenio de Colaboracion para la Proteccion del Cliente Emisor" },
  { code: "27", label: "Pago opcional no aceptado por el Participante Receptor" },
  { code: "28", label: "Tipo de pago CoDi sin notificacion de abono en tiempo reducido" },
  { code: "30", label: "Clave de rastreo repetida por Participante Emisor y dia de operacion" },
  { code: "31", label: "Certificado del Participante Emisor vencido" },
] as const;

export const METHOD_CORRECTION_REASONS = [
  {
    code: "SPEI_17_TIPO_CUENTA_NO_CORRESPONDE",
    label: "17 - Tipo de cuenta no corresponde",
    speiCode: "17",
  },
  {
    code: "SPEI_15_TIPO_PAGO_ERRONEO",
    label: "15 - Tipo de pago erroneo",
    speiCode: "15",
  },
  {
    code: "SPEI_16_TIPO_OPERACION_ERRONEA",
    label: "16 - Tipo de operacion erronea",
    speiCode: "16",
  },
  {
    code: "SPEI_01_CUENTA_INEXISTENTE",
    label: "01 - Cuenta inexistente",
    speiCode: "01",
  },
  {
    code: "SPEI_06_CUENTA_NO_PERTENECE_RECEPTOR",
    label: "06 - Cuenta no pertenece al Participante Receptor",
    speiCode: "06",
  },
  {
    code: "CORRECCION_DATOS_METODO",
    label: "Correccion de datos del metodo",
    speiCode: null,
  },
] as const;