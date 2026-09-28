type Note = Record<string, any>;
const clean = (value: unknown) => String(value ?? "").trim();

/** Legacy notes remain readable; an unknown human author is never invented. */
export function isSystemNote(note: Note) {
  if (note.authorType === "USER" || note.origin === "MANUAL") return false;
  return note.authorType === "SYSTEM" || note.system === true ||
    ["system", "sistema", "iq", "firebase", "hugo", "maria", "maría", "scheduler"].includes(clean(note.createdBy).toLowerCase()) ||
    ["system", "sistema"].includes(clean(note.createdByRole).toLowerCase()) ||
    /^(IQ|DESPACHO|PAGO_DOC_RETRY)/.test(clean(note.origin || note.source)) ||
    /^FOLIO IQ:|^Deposito IQ creado |^Pago conciliado .*IQ|^Lote atomico |^Factura PDF y Factura XML agregadas/.test(clean(note.text));
}

export function noteAuthorLabel(note: Note) {
  if (isSystemNote(note)) return "Sistema";
  for (const candidate of [note.authorName, note.createdByName, note.createdByUsername]) {
    const name = clean(candidate);
    if (name && name !== note.createdBy && name !== note.authorId && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(name)) return name;
  }
  return "Usuario no disponible";
}
