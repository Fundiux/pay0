"use client";


import { parsePay0MassiveLayoutRows, type Pay0MassiveMethodTipo, type Pay0MassiveParseResult } from "@/lib/pay0MassiveLayout";
import { readPay0MassiveRowsFromFile } from "@/lib/readPay0MassiveExcel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { listScopedClients } from "@/services/clients";
import { BANK_OPTIONS, findBankByCode } from "@/constants/banks";
import { METHOD_CORRECTION_REASONS } from "@/constants/speiReturnCauses";
import { CirclePlus, Pencil, Power, PowerOff,
  ChevronDown, Search, Trash2, UploadCloud, Wrench } from "lucide-react";
import Modal from "@/components/Modal";
import { useGlobalLoading } from "@/components/GlobalLoading";
import UiSelect from "@/components/UiSelect";
import {
  addClientBeneficiaryMethod,
  createClientBeneficiary,
  deleteClientBeneficiary,
  deleteClientBeneficiaryMethod,
  toggleClientBeneficiaryActive,
  toggleClientBeneficiaryMethodActive,
  updateClientBeneficiary,
  updateClientBeneficiaryMethod,
  replaceClientBeneficiaryMethod,
  watchClientBeneficiaries,
  watchClientBeneficiaryMethods,
  type BeneficiaryTipo,
  type ClientBeneficiaryMethodRow,
  type ClientBeneficiaryRow,
  type DestinationKind,
} from "@/services/beneficiaries";

interface ClientOption {
  id: string;
  label: string;
}

interface DraftMethod {
  key: string;
  tipo: BeneficiaryTipo;
  destinationKind: DestinationKind;
  bankCode: string;
  bankName: string;
  clabe: string;
  cardNumber: string;
}

type FormBeneficiaryTipo = BeneficiaryTipo | "";
type FormDestinationKind = DestinationKind | "";

function normalizeNombreInput(value: string) {
  return value.replace(/\s+/g, " ").trimStart().toUpperCase().slice(0, 180);
}

function onlyDigits(value: string) {
  return value.replace(/\D+/g, "");
}

function isMethodReplaced(row: ClientBeneficiaryMethodRow) {
  const data = row as any;

  return Boolean(
    data?.replaced === true ||
    String(data?.replacementStatus || "").toUpperCase() === "REPLACED" ||
    String(data?.replacedByMethodId || "").trim()
  );
}

function toggleButtonClass(active: boolean) {
  return active
    ? "rounded-xl border px-2.5 py-1 text-[10px] font-normal uppercase transition-all border-rose-400/20 text-rose-400 hover:bg-rose-500/10"
    : "rounded-xl border px-2.5 py-1 text-[10px] font-normal uppercase transition-all border-emerald-400/20 text-emerald-400 hover:bg-emerald-500/10";
}

function secondaryButtonClass() {
  return "rounded-xl border border-sky-500/50 px-2.5 py-1 text-[10px] font-normal uppercase text-sky-400 transition hover:bg-sky-500/10";
}

export default function WalletBeneficiariosPage() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile();
  const globalLoading = useGlobalLoading();

  const uid = String((user as any)?.uid || "").trim();
  const role = String((profile as any)?.role || "").trim();
  const isSuperadmin = role === "superadmin";
  const rootId = String((profile as any)?.rootId || uid || "").trim();

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [beneficiaries, setBeneficiaries] = useState<ClientBeneficiaryRow[]>([]);
  const [methods, setMethods] = useState<ClientBeneficiaryMethodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const textResolverRef = useRef<((value: string | null) => void) | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    tone?: "primary" | "danger";
    hideCancel?: boolean;
  }>(null);

  const [textDialog, setTextDialog] = useState<null | {
    title: string;
    label: string;
    helper?: string;
    confirmLabel: string;
  }>(null);

  const [textDialogValue, setTextDialogValue] = useState("");

  const [methodEditDialog, setMethodEditDialog] = useState<null | {
    methodId: string;
    tipo: BeneficiaryTipo;
    bankCode: string;
    destinationKind: DestinationKind;
    clabe: string;
    cardNumber: string;
    mode?: "EDIT" | "REPLACE";
    replacementReason?: string;
  }>(null);
  const [methodEditSaving, setMethodEditSaving] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
const [expandedBeneficiaries, setExpandedBeneficiaries] = useState<Record<string, boolean>>({});
  const [openBeneficiaryModal, setOpenBeneficiaryModal] = useState(false);
  const [beneficiaryModalTab, setBeneficiaryModalTab] = useState<"CAPTURA" | "MASIVA">("CAPTURA");
  const [isImportDragging, setIsImportDragging] = useState(false);

  const [nombre, setNombre] = useState("");
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState("");
  const [selectedBeneficiaryName, setSelectedBeneficiaryName] = useState("");
  const [beneficiaryImportPreview, setBeneficiaryImportPreview] = useState<Pay0MassiveParseResult | null>(null);
  const [beneficiaryImportFileName, setBeneficiaryImportFileName] = useState("");
  const [beneficiaryImportMethodTipo, setBeneficiaryImportMethodTipo] = useState<Pay0MassiveMethodTipo>("DEBITO");

  const [tipo, setTipo] = useState<FormBeneficiaryTipo>("");
  const [destinationKind, setDestinationKind] = useState<FormDestinationKind>("");
  const [bankCode, setBankCode] = useState("");
  const [clabe, setClabe] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [draftMethods, setDraftMethods] = useState<DraftMethod[]>([]);

  const sortedBanks = useMemo(
    () => [...BANK_OPTIONS].sort((a, b) => a.name.localeCompare(b.name, "es")),
    []
  );

  const AMEX_BANK_LABEL = "AMERICAN EXPRESS";

  const groupedMethods = useMemo(() => {
    return methods.reduce<Record<string, ClientBeneficiaryMethodRow[]>>((acc, row) => {
      const key = String(row.beneficiaryId || "");
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [methods]);

  const displayedBeneficiaries = useMemo(() => {
    const term = beneficiarySearch.trim().toLowerCase();
    const sorted = [...beneficiaries].sort((a, b) =>
      String(a.nombre || a.nombreNormalizado || "").localeCompare(
        String(b.nombre || b.nombreNormalizado || ""),
        "es"
      )
    );

    if (!term) return sorted;

    return sorted.filter((row) =>
      String(row.nombre || row.nombreNormalizado || "").toLowerCase().includes(term)
    );
  }, [beneficiaries, beneficiarySearch]);

  useEffect(() => {
    if (profileLoading) {
      setClients([]);
      return;
    }

    if (!uid || !rootId) {
      setClients([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const unsubscribe = listScopedClients(
      { uid, role, rootId },
      (items) => {
        const options: ClientOption[] = items
          .map((item: any) => ({
            id: String(item.id || ""),
            label: String(
              item.name ||
              item.nombreComercial ||
              item.nombre ||
              item.razonSocial ||
              item.clienteNombre ||
              item.id ||
              ""
            ),
          }))
          .filter((item) => item.id && item.label)
          .sort((a, b) => a.label.localeCompare(b.label, "es"));

        setClients(options);

        setLoading(false);
      },
      (e) => {
        setClients([]);
        setLoading(false);
        setError(e?.message || "No se pudieron cargar los clientes.");
      }
    );

    return () => unsubscribe();
  }, [uid, role, rootId, profileLoading]);

  useEffect(() => {
    if (!clientId) {
      setBeneficiaries([]);
      setMethods([]);
      return;
    }

    const off1 = watchClientBeneficiaries(
      clientId,
      (rows) => setBeneficiaries(rows),
      (e) => setError(e.message || "No se pudieron cargar los beneficiarios.")
    );

    const off2 = watchClientBeneficiaryMethods(
      clientId,
      (rows) => setMethods(rows),
      (e) => setError(e.message || "No se pudieron cargar los metodos.")
    );

    return () => {
      off1();
      off2();
    };
  }, [clientId]);

  useEffect(() => {
    if (!tipo) {
      setDestinationKind("");
      setBankCode("");
      setClabe("");
      setCardNumber("");
      return;
    }

    if (tipo === "EFECTIVO") {
      setDestinationKind("EFECTIVO");
      setBankCode("");
      setClabe("");
      setCardNumber("");
      return;
    }

    if (tipo === "AMEX") {
      setDestinationKind("TARJETA");
      setBankCode("");
      setClabe("");
      return;
    }

    if (destinationKind === "EFECTIVO") {
      setDestinationKind("");
    }
  }, [tipo, destinationKind]);

  function resetMethodForm() {
    setTipo("");
    setDestinationKind("");
    setBankCode("");
    setClabe("");
    setCardNumber("");
  }

  function clearDraftAndMethodForm() {
    setDraftMethods([]);
    resetMethodForm();
  }

  function clearWholeForm() {
    setSelectedBeneficiaryId("");
    setSelectedBeneficiaryName("");
    setNombre("");
    clearDraftAndMethodForm();
    setError("");
  }

  function askConfirm(options: {
    title: string;
    message: string;
    confirmLabel?: string;
    tone?: "primary" | "danger";
    hideCancel?: boolean;
  }) {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel || "Confirmar",
        tone: options.tone || "primary",
        hideCancel: Boolean(options.hideCancel),
      });
    });
  }

  function resolveConfirm(value: boolean) {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(value);
  }

  function askText(options: {
    title: string;
    label: string;
    initialValue?: string;
    helper?: string;
    confirmLabel?: string;
  }) {
    return new Promise<string | null>((resolve) => {
      textResolverRef.current = resolve;
      setTextDialogValue(String(options.initialValue || ""));
      setTextDialog({
        title: options.title,
        label: options.label,
        helper: options.helper,
        confirmLabel: options.confirmLabel || "Guardar",
      });
    });
  }

  function resolveText(value: string | null) {
    const resolver = textResolverRef.current;
    textResolverRef.current = null;
    setTextDialog(null);
    resolver?.(value);
  }

  async function handleBeneficiaryImportFile(file: File | null) {
    setError("");

    setBeneficiaryImportPreview(null);
    setBeneficiaryImportFileName("");

    if (!file) return;

    try {
      await globalLoading.run(undefined, async () => {
        const rows = await readPay0MassiveRowsFromFile(file, {
          preferredSheetNames: ["ADMON"],
          requiredHeaders: ["NOMBRE"],
          maxHeaderScanRows: 30,
        });

        const preview = parsePay0MassiveLayoutRows(rows, "BENEFICIARIOS", { methodTipo: beneficiaryImportMethodTipo });
        setBeneficiaryImportPreview(preview);
        setBeneficiaryImportFileName(file.name);

        if (preview.totals.rows === 0) {
          setError("El archivo no contiene filas para importar.");
        } else if (preview.totals.errors > 0) {
          setError(`Preview generado con ${preview.totals.errors} fila(s) con error.`);
        }
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo Excel.");
    }
  }
  function validateCurrentMethod(): { ok: true } | { ok: false; message: string } {
    if (!tipo) {
      return { ok: false, message: "Selecciona tipo." };
    }

    if (tipo === "EFECTIVO") {
      return { ok: true };
    }

    if (tipo === "AMEX") {
      const digits = onlyDigits(cardNumber);
      if (digits.length !== 15) {
        return { ok: false, message: "La tarjeta AMEX debe tener 15 digitos." };
      }
      return { ok: true };
    }

    if (!destinationKind) {
      return { ok: false, message: "Selecciona destino." };
    }

    if (!bankCode) {
      return { ok: false, message: "Selecciona banco." };
    }

    if (destinationKind === "CLABE") {
      const digits = onlyDigits(clabe);
      if (digits.length !== 18) {
        return { ok: false, message: "La CLABE debe tener 18 digitos." };
      }
      if (digits.slice(0, 3) !== bankCode) {
        return { ok: false, message: "La CLABE no coincide con el banco seleccionado." };
      }
      return { ok: true };
    }

    if (destinationKind === "TARJETA") {
      const digits = onlyDigits(cardNumber);
      const required = 16;
      if (digits.length !== required) {
        return {
          ok: false,
          message: "La tarjeta debe tener 16 digitos.",
        };
      }
      return { ok: true };
    }

    return { ok: false, message: "Selecciona un destino valido." };
  }

  function handleAddDraftMethod() {
    setError("");

    const validation = validateCurrentMethod();
    if (!validation.ok) {
      setError("message" in validation ? validation.message : "Metodo invalido.");
      return;
    }

    const finalTipo = tipo as BeneficiaryTipo;
    const finalDestinationKind = destinationKind as DestinationKind;
    const bank = findBankByCode(bankCode);
    const finalKind: DestinationKind = finalTipo === "EFECTIVO" ? "EFECTIVO" : finalDestinationKind;
    const finalClabe = finalKind === "CLABE" ? onlyDigits(clabe) : "";
    const finalCard = finalKind === "TARJETA" ? onlyDigits(cardNumber) : "";
    const finalBankCode = finalTipo === "EFECTIVO" || finalTipo === "AMEX" ? "" : bankCode;
    const finalBankName = finalTipo === "AMEX" ? AMEX_BANK_LABEL : finalTipo === "EFECTIVO" ? "" : bank?.name || "";

    const existsInDraft = draftMethods.some(
      (item) =>
        item.tipo === finalTipo &&
        (item.clabe || "") === finalClabe &&
        (item.cardNumber || "") === finalCard &&
        (item.bankCode || "") === finalBankCode
    );

    if (existsInDraft) {
      setError("Ese metodo ya esta en captura.");
      return;
    }

    setDraftMethods((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        tipo: finalTipo,
        destinationKind: finalKind,
        bankCode: finalBankCode,
        bankName: finalBankName,
        clabe: finalClabe,
        cardNumber: finalCard,
      },
    ]);

    resetMethodForm();
  }

  function handleRemoveDraftMethod(key: string) {
    setDraftMethods((prev) => prev.filter((item) => item.key !== key));
  }

  async function handleSave() {
    if (saving) return;
    setError("");

    if (!clientId) {
      setError("Selecciona cliente.");
      return;
    }

    if (!nombre.trim()) {
      setError("Captura nombre del beneficiario.");
      return;
    }

    const validation = validateCurrentMethod();
    if (!validation.ok) {
      setError("message" in validation ? validation.message : "Metodo invalido.");
      return;
    }

    const finalTipo = tipo as BeneficiaryTipo;
    const finalDestinationKind = destinationKind as DestinationKind;
    const bank = findBankByCode(bankCode);
    const finalKind: DestinationKind = finalTipo === "EFECTIVO" ? "EFECTIVO" : finalDestinationKind;
    const methodPayload = {
      tipo: finalTipo,
      bankCode: finalTipo === "EFECTIVO" || finalTipo === "AMEX" ? "" : bankCode,
      bankName: finalTipo === "AMEX" ? AMEX_BANK_LABEL : finalTipo === "EFECTIVO" ? "" : bank?.name || "",
      clabe: finalKind === "CLABE" ? onlyDigits(clabe) : "",
      cardNumber: finalKind === "TARJETA" ? onlyDigits(cardNumber) : "",
    };

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        if (selectedBeneficiaryId) {
          await addClientBeneficiaryMethod({
            beneficiaryId: selectedBeneficiaryId,
            ...methodPayload,
          });
        } else {
          await createClientBeneficiary({
            clientId,
            nombre: normalizeNombreInput(nombre),
            methods: [methodPayload],
          });
        }

        clearWholeForm();
        setOpenBeneficiaryModal(false);
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el beneficiario.");
    } finally {
      setSaving(false);
    }
  }

  function handlePrepareAddMethod(beneficiary: ClientBeneficiaryRow) {
    const beneficiaryName = String(beneficiary.nombre || "").trim();
    setSelectedBeneficiaryId(beneficiary.id);
    setSelectedBeneficiaryName(beneficiaryName);
    setNombre(beneficiaryName);
    setDraftMethods([]);
    resetMethodForm();
    setError("");

    setBeneficiaryModalTab("CAPTURA");
    setOpenBeneficiaryModal(true);
  }

  function normalizeImportText(value: unknown) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function resolveImportBankCode(bankName: string, clabeValue: string) {
    const clabeDigits = String(clabeValue || "").replace(/\D/g, "");
    if (clabeDigits.length === 18) {
      return clabeDigits.slice(0, 3);
    }

    const normalized = normalizeImportText(bankName);

    const bankMap: Record<string, string> = {
      "BANAMEX": "002",
      "CITIBANAMEX": "002",
      "BANCO NACIONAL DE MEXICO": "002",
      "BBVA": "012",
      "BBVA MEXICO": "012",
      "BANCOMER": "012",
      "SANTANDER": "014",
      "HSBC": "021",
      "BAJIO": "030",
      "BANBAJIO": "030",
      "INBURSA": "036",
      "MIFEL": "042",
      "SCOTIABANK": "044",
      "BANREGIO": "058",
      "INVEX": "059",
      "AFIRME": "062",
      "BANORTE": "072",
      "IXE": "072",
      "THE ROYAL BANK": "102",
      "AMERICAN EXPRESS": "103",
      "AMEX": "103",
      "BANSI": "106",
      "VE POR MAS": "113",
      "INTERCAM": "136",
      "BANCOPPEL": "137",
      "BANCOPEL": "137",
      "ABC CAPITAL": "138",
      "KUSPIT": "140",
      "BANCO BASE": "145",
      "MULTIVA": "132",
      "ACTINVER": "133",
      "AZTECA": "127",
      "BANCO AZTECA": "127",
      "CIBANCO": "143",
      "BMONEX": "112",
      "MONEX": "112",
      "STP": "646",
      "MERCADO PAGO": "722",
      "NU": "638",
      "NU MEXICO": "638",
    };

    return bankMap[normalized] || "";
  }
  function resolveImportBankName(bankName: string, clabeValue: string) {
    const clabeDigits = String(clabeValue || "").replace(/\D/g, "");
    const normalized = normalizeImportText(bankName);

    const bankNames: Record<string, string> = {
      "002": "BANAMEX",
      "012": "BBVA MEXICO",
      "014": "SANTANDER",
      "021": "HSBC",
      "030": "BANBAJIO",
      "036": "INBURSA",
      "042": "MIFEL",
      "044": "SCOTIABANK",
      "058": "BANREGIO",
      "059": "INVEX",
      "062": "AFIRME",
      "072": "BANORTE",
      "103": "AMERICAN EXPRESS",
      "106": "BANSI",
      "112": "MONEX",
      "113": "VE POR MAS",
      "127": "BANCO AZTECA",
      "132": "MULTIVA",
      "133": "ACTINVER",
      "136": "INTERCAM",
      "137": "BANCOPPEL",
      "138": "ABC CAPITAL",
      "140": "KUSPIT",
      "143": "CIBANCO",
      "145": "BANCO BASE",
      "646": "STP",
      "722": "MERCADO PAGO",
      "638": "NU MEXICO",
    };

    const aliases: Record<string, string> = {
      "BANAMEX": "BANAMEX",
      "CITIBANAMEX": "BANAMEX",
      "BBVA": "BBVA MEXICO",
      "BBVA MEXICO": "BBVA MEXICO",
      "BANCOMER": "BBVA MEXICO",
      "SANTANDER": "SANTANDER",
      "BANORTE": "BANORTE",
      "AZTECA": "BANCO AZTECA",
      "BANCO AZTECA": "BANCO AZTECA",
      "BANCOPPEL": "BANCOPPEL",
      "BANCOPEL": "BANCOPPEL",
      "BANCO COPPEL": "BANCOPPEL",
      "AMEX": "AMERICAN EXPRESS",
      "AMERICAN EXPRESS": "AMERICAN EXPRESS",
      "NU": "NU MEXICO",
      "NU MEXICO": "NU MEXICO",
    };

    if (clabeDigits.length === 18) {
      const code = clabeDigits.slice(0, 3);
      return bankNames[code] || aliases[normalized] || String(bankName || "").trim();
    }

    return aliases[normalized] || String(bankName || "").trim();
  }
  function buildImportMethod(row: any): DraftMethod {
    const bankName = String(row.banco || "").trim();
    const normalizedBank = normalizeImportText(bankName);
    const destinationKindValue = String(row.destinationKind || "EFECTIVO").trim().toUpperCase();

    const tipoValue: BeneficiaryTipo = String(row.methodTipo || beneficiaryImportMethodTipo || "DEBITO") as BeneficiaryTipo;

    const finalKind: DestinationKind =
      destinationKindValue === "CLABE"
        ? "CLABE"
        : destinationKindValue === "TARJETA"
          ? "TARJETA"
          : "EFECTIVO";

    const finalBankCode = resolveImportBankCode(bankName, String(row.clabe || ""));
    const finalBankName = resolveImportBankName(bankName, String(row.clabe || ""));

    return {
      key: `import-${String(row.rowNumber || "")}-${finalKind}-${String(row.clabe || "")}-${String(row.numeroTarjeta || "")}`,
      tipo: tipoValue,
      destinationKind: finalKind,
      bankCode: finalKind === "EFECTIVO" ? "" : finalBankCode,
      bankName: finalBankName,
      clabe: finalKind === "CLABE" ? String(row.clabe || "").trim() : "",
      cardNumber: finalKind === "TARJETA" ? String(row.numeroTarjeta || "").trim() : "",
    };
  }

  function methodKeyFromValues(values: {
    destinationKind?: string | null;
    clabe?: string | null;
    cardNumber?: string | null;
    bankName?: string | null;
  }) {
    return [
      normalizeImportText(values.destinationKind || ""),
      String(values.clabe || "").replace(/\D/g, ""),
      String(values.cardNumber || "").replace(/\D/g, ""),
      normalizeImportText(values.bankName || ""),
    ].join("|");
  }

  async function handleCreateBeneficiariesFromPreview() {
    if (saving) return;
    setError("");

    if (!clientId) {
      setError("Selecciona un cliente antes de crear beneficiarios.");
      return;
    }

    if (!beneficiaryImportPreview || beneficiaryImportPreview.validRows.length === 0) {
      setError("No hay filas validas para crear.");
      return;
    }

    const confirmed = await askConfirm({
      title: "Crear beneficiarios",
      message: `Crear ${beneficiaryImportPreview.validRows.length} beneficiario(s)/metodo(s) para el cliente seleccionado?`,
      confirmLabel: "Crear",
      tone: "primary",
    });

    if (!confirmed) return;

    setSaving(true);

    try {
      const summary = await globalLoading.run(undefined, async () => {
        let createdBeneficiaries = 0;
        let createdMethods = 0;
        let skippedDuplicates = 0;

        const beneficiaryByName = new Map<string, ClientBeneficiaryRow>();
        for (const item of beneficiaries) {
          beneficiaryByName.set(normalizeImportText(item.nombre), item);
        }

        const methodsByBeneficiary = new Map<string, Set<string>>();
        for (const item of methods) {
          const beneficiaryId = String(item.beneficiaryId || "");
          if (!methodsByBeneficiary.has(beneficiaryId)) {
            methodsByBeneficiary.set(beneficiaryId, new Set<string>());
          }

          methodsByBeneficiary.get(beneficiaryId)?.add(
            methodKeyFromValues({
              destinationKind: item.destinationKind,
              clabe: item.clabe,
              cardNumber: item.cardNumber,
              bankName: item.bankName,
            })
          );
        }

        for (const row of beneficiaryImportPreview.validRows) {
          const beneficiaryName = String(row.nombre || "").trim();
          if (!beneficiaryName) continue;

          const method = buildImportMethod(row);

          if (!/^\d{3}$/.test(String(method.bankCode || ""))) {
            throw new Error(`Fila ${row.rowNumber}: BANCO no reconocido para importacion (${row.banco || "-"}).`);
          }

          const existing = beneficiaryByName.get(normalizeImportText(beneficiaryName));
          const methodKey = methodKeyFromValues(method);

          if (existing?.id) {
            const existingMethodKeys = methodsByBeneficiary.get(existing.id) || new Set<string>();

            if (existingMethodKeys.has(methodKey)) {
              skippedDuplicates += 1;
              continue;
            }

            await addClientBeneficiaryMethod({
              beneficiaryId: existing.id,
              tipo: method.tipo,
              bankCode: method.bankCode || "",
              bankName: method.bankName || "",
              clabe: method.clabe || "",
              cardNumber: method.cardNumber || "",
            });

            existingMethodKeys.add(methodKey);
            methodsByBeneficiary.set(existing.id, existingMethodKeys);
            createdMethods += 1;
            continue;
          }

          await createClientBeneficiary({
            clientId,
            nombre: beneficiaryName,
            methods: [method],
          });

          createdBeneficiaries += 1;
        }

        setBeneficiaryImportPreview(null);
        setBeneficiaryImportFileName("");

        return {
          createdBeneficiaries,
          createdMethods,
          skippedDuplicates,
        };
      });

      await askConfirm({
        title: "Importacion terminada",
        message: `Beneficiarios creados: ${summary.createdBeneficiaries}\nMetodos agregados: ${summary.createdMethods}\nDuplicados omitidos: ${summary.skippedDuplicates}`,
        confirmLabel: "Ok",
        tone: "primary",
        hideCancel: true,
      });
    } catch (e: any) {
      setError(e?.message || "No se pudieron crear los beneficiarios masivos.");
    } finally {
      setSaving(false);
    }
  }
  async function handleToggleBeneficiary(row: ClientBeneficiaryRow) {
    if (saving) return;
    setError("");

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        await toggleClientBeneficiaryActive({
          beneficiaryId: row.id,
          active: !Boolean(row.active),
        });
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar el beneficiario.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleMethod(row: ClientBeneficiaryMethodRow) {
    if (saving) return;
    setError("");

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        await toggleClientBeneficiaryMethodActive({
          methodId: row.id,
          active: !Boolean(row.active),
        });
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar el metodo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditBeneficiary(row: ClientBeneficiaryRow) {
    if (!isSuperadmin) {
      setError("Solo superadmin puede editar o eliminar beneficiarios.");
      return;
    }

    if (saving) return;
    setError("");

    const currentName = String(row.nombre || "").trim();
    const nextNameRaw = await askText({
      title: "Editar beneficiario",
      label: "Nombre del beneficiario",
      initialValue: currentName,
      confirmLabel: "Guardar",
    });

    if (nextNameRaw === null) return;

    const nextName = normalizeNombreInput(nextNameRaw);

    if (!nextName) {
      setError("Nombre requerido.");
      return;
    }

    if (nextName === currentName) return;

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        await updateClientBeneficiary({
          beneficiaryId: row.id,
          nombre: nextName,
        });
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo editar el beneficiario.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBeneficiary(row: ClientBeneficiaryRow) {
    if (!isSuperadmin) {
      setError("Solo superadmin puede editar o eliminar beneficiarios.");
      return;
    }

    if (saving) return;
    setError("");

    const name = String(row.nombre || row.id || "").trim();
    const confirmed = await askConfirm({
      title: "Eliminar beneficiario",
      message: `Eliminar beneficiario ${name}? Solo se permite si no tiene movimientos.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });

    if (!confirmed) return;

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        await deleteClientBeneficiary({
          beneficiaryId: row.id,
        });
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar el beneficiario. Si tiene movimientos, solo desactivalo.");
    } finally {
      setSaving(false);
    }
  }

  function handleEditMethod(row: ClientBeneficiaryMethodRow, mode: "EDIT" | "REPLACE" = "EDIT") {
    if (!isSuperadmin) {
      setError("Solo superadmin puede editar o eliminar beneficiarios.");
      return;
    }

    if (saving || methodEditSaving) return;
    setError("");

    const nextTipo = String(row.tipo || "DEBITO").toUpperCase() as BeneficiaryTipo;
    const nextDestinationKind = String(row.destinationKind || (row.clabe ? "CLABE" : "TARJETA")) as DestinationKind;

    setMethodEditDialog({
      methodId: row.id,
      tipo: nextTipo,
      bankCode: String(row.bankCode || ""),
      destinationKind: nextDestinationKind === "EFECTIVO" ? "CLABE" : nextDestinationKind,
      clabe: String(row.clabe || ""),
      cardNumber: String(row.cardNumber || ""),
      mode,
      replacementReason: mode === "REPLACE" ? METHOD_CORRECTION_REASONS[0].code : "",
    });
  }

  async function handleSaveMethodEdit() {
    if (!isSuperadmin) {
      setError("Solo superadmin puede editar o eliminar beneficiarios.");
      return;
    }

    if (methodEditSaving) return;
    if (!methodEditDialog) return;

    setError("");

    const nextTipo = methodEditDialog.tipo;
    const nextDestinationKind: DestinationKind = nextTipo === "EFECTIVO" ? "EFECTIVO" : methodEditDialog.destinationKind;
    const nextBankCode = String(methodEditDialog.bankCode || "");
    const bank = findBankByCode(nextBankCode);
    const isReplacement = methodEditDialog.mode === "REPLACE";
    const replacementReason = String(methodEditDialog.replacementReason || "").trim();

    if (isReplacement && !replacementReason) {
      setError("Captura el motivo de correccion.");
      return;
    }

    if (nextTipo !== "EFECTIVO" && !bank) {
      setError("Selecciona banco.");
      return;
    }

    if (nextTipo !== "EFECTIVO" && nextDestinationKind === "CLABE") {
      const nextClabe = onlyDigits(methodEditDialog.clabe);
      if (nextClabe.length !== 18) {
        setError("CLABE debe tener 18 digitos.");
        return;
      }
    }

    if (nextTipo !== "EFECTIVO" && nextDestinationKind === "TARJETA") {
      const nextCard = onlyDigits(methodEditDialog.cardNumber);
      const expected = nextTipo === "AMEX" ? 15 : 16;
      if (nextCard.length !== expected) {
        setError(`Tarjeta debe tener ${expected} digitos.`);
        return;
      }
    }

    setMethodEditSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        const payload = {
          methodId: methodEditDialog.methodId,
          tipo: nextTipo,
          bankCode: nextTipo === "EFECTIVO" ? "" : nextBankCode,
          bankName: nextTipo === "EFECTIVO" ? "" : bank?.name || "",
          clabe: nextDestinationKind === "CLABE" ? onlyDigits(methodEditDialog.clabe) : "",
          cardNumber: nextDestinationKind === "TARJETA" ? onlyDigits(methodEditDialog.cardNumber) : "",
        };

        if (isReplacement) {
          await replaceClientBeneficiaryMethod({
            ...payload,
            replacementReason,
          });
        } else {
          await updateClientBeneficiaryMethod(payload);
        }

        setMethodEditDialog(null);
      });
    } catch (e: any) {
      setError(e?.message || (isReplacement ? "No se pudo corregir el metodo." : "No se pudo editar el metodo."));
    } finally {
      setMethodEditSaving(false);
    }
  }

  async function handleDeleteMethod(row: ClientBeneficiaryMethodRow) {
    if (!isSuperadmin) {
      setError("Solo superadmin puede editar o eliminar beneficiarios.");
      return;
    }

    if (saving) return;
    setError("");

    const label = `${row.tipo || "METODO"} ${row.bankName || ""}`.trim();
    const confirmed = await askConfirm({
      title: "Eliminar metodo",
      message: `Eliminar metodo ${label}? Solo se permite si no tiene movimientos.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });

    if (!confirmed) return;

    setSaving(true);
    try {
      await globalLoading.run(undefined, async () => {
        await deleteClientBeneficiaryMethod({
          methodId: row.id,
        });
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar el metodo. Si tiene movimientos, solo desactivalo.");
    } finally {
      setSaving(false);
    }
  }

  // D6E window drop beneficiarios
  useEffect(() => {
    function isAllowedMassiveFile(file: File | null) {
      const name = String(file?.name || "").toLowerCase();
      return Boolean(
        file &&
          (name.endsWith(".xlsx") || name.endsWith(".csv"))
      );
    }

    function handleWindowDragEnter(event: DragEvent) {
      if (!clientId || saving) return;
      event.preventDefault();
      setIsImportDragging(true);
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!clientId || saving) return;
      event.preventDefault();
      setIsImportDragging(true);
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsImportDragging(false);
      }
    }

    function handleWindowDrop(event: DragEvent) {
      if (event.defaultPrevented) return;

      event.preventDefault();
      setIsImportDragging(false);

      if (saving) return;

      const file = event.dataTransfer?.files?.[0] || null;
      if (!file) return;

      if (!clientId) {
        setError("Selecciona un cliente antes de cargar beneficiarios.");
        return;
      }

      if (!isAllowedMassiveFile(file)) {
        setError("Solo se permite Excel .xlsx o CSV para beneficiarios masivos.");
        return;
      }

      setError("");
      setBeneficiaryModalTab("MASIVA");
      setOpenBeneficiaryModal(true);
      void handleBeneficiaryImportFile(file);
    }

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [clientId, saving, handleBeneficiaryImportFile]);
  const currentClabeDigits = onlyDigits(clabe);
  const currentCardDigits = onlyDigits(cardNumber);
  const currentCardRequiredDigits = tipo === "AMEX" ? 15 : 16;
  const currentMethodReady = Boolean(
    tipo &&
      (tipo === "EFECTIVO" ||
        (tipo === "AMEX" && currentCardDigits.length === 15) ||
        (bankCode &&
          destinationKind &&
          ((destinationKind === "CLABE" &&
            currentClabeDigits.length === 18 &&
            currentClabeDigits.slice(0, 3) === bankCode) ||
            (destinationKind === "TARJETA" && currentCardDigits.length === currentCardRequiredDigits))))
  );
  const canSave = Boolean(clientId && nombre.trim() && currentMethodReady && !saving);

  return (
    <div className="relative space-y-5">
      {isImportDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[#0063C4]/60 bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <UploadCloud size={34} strokeWidth={1.8} className="mx-auto mb-2 text-sky-200" />
            <div className="text-[14px] font-normal text-white">Suelta el Excel aqui</div>
            <div className="mt-1 text-[12px] text-slate-400">Se abrira la carga masiva de beneficiarios</div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-[280px_1fr_170px_170px] xl:items-center">
        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
            size={18}
            strokeWidth={1.8}
          />

          <input
            value={beneficiarySearch}
            onChange={(e) => setBeneficiarySearch(e.target.value)}
            placeholder="Buscar por nombre de beneficiario..."
            className="h-[42px] w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-sky-500/70"
          />
        </div>

        <UiSelect
          value={clientId}
          onChange={(nextClientId) => {
            setClientId(nextClientId);
            setBeneficiarySearch("");
            clearWholeForm();
          }}
          options={clients.map((client) => ({
            value: client.id,
            label: client.label,
          }))}
          placeholder="Selecciona cliente"
        />

        <button
          type="button"
          onClick={() => {
            clearWholeForm();
            setBeneficiaryModalTab("MASIVA");
            setOpenBeneficiaryModal(true);
          }}
          disabled={!clientId}
          className="inline-flex h-[42px] items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 text-sm text-slate-300 transition hover:border-sky-400 hover:bg-sky-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          + Importar Excel
        </button>

        <button
          type="button"
          onClick={() => {
            clearWholeForm();
            setBeneficiaryModalTab("CAPTURA");
            setOpenBeneficiaryModal(true);
          }}
          disabled={!clientId}
          className="inline-flex h-[42px] items-center justify-center rounded-xl bg-blue-600 px-5 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          + Beneficiario
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-400">Cargando...</p> : null}
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <Modal
        open={openBeneficiaryModal}
        title=""
        onClose={() => {
          clearWholeForm();
          setOpenBeneficiaryModal(false);
          setIsImportDragging(false);
        }}
        widthClassName="max-w-[390px]"
      >
        <div className="space-y-3">
          <div className="grid w-full grid-cols-2 rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setBeneficiaryModalTab("CAPTURA")}
              className={`w-full rounded-lg px-3 py-2 text-[13px] font-normal transition ${beneficiaryModalTab === "CAPTURA" ? "bg-[#0063C4]/25 text-sky-100" : "text-slate-400 hover:text-white"}`}
            >
              Captura
            </button>
            <button
              type="button"
              onClick={() => setBeneficiaryModalTab("MASIVA")}
              className={`w-full rounded-lg px-3 py-2 text-[13px] font-normal transition ${beneficiaryModalTab === "MASIVA" ? "bg-[#0063C4]/25 text-sky-100" : "text-slate-400 hover:text-white"}`}
            >
              Masiva
            </button>
          </div>

          {beneficiaryModalTab === "MASIVA" ? (
            <div className="grid gap-2">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">Tipo de metodo archivo</div>
                <UiSelect
                  value={beneficiaryImportMethodTipo}
                  onChange={(value) => {
                    setBeneficiaryImportMethodTipo(value as Pay0MassiveMethodTipo);
                    setBeneficiaryImportPreview(null);
                    setBeneficiaryImportFileName("");
                    setError("");
                  }}
                  options={[
                    { value: "DEBITO", label: "DEBITO" },
                    { value: "TDC", label: "TDC" },
                    { value: "AMEX", label: "AMEX" },
                  ]}
                  placeholder="Tipo de metodo archivo"
                />
              </div>

              <label
                onDragEnter={() => setIsImportDragging(true)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsImportDragging(true);
                }}
                onDragLeave={() => setIsImportDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsImportDragging(false);
                  const file = e.dataTransfer.files?.[0] || null;
                  void handleBeneficiaryImportFile(file);
                }}
                className={`flex min-h-[104px] w-full cursor-pointer items-center justify-center rounded-xl border border-dashed transition ${
                  isImportDragging
                    ? "border-sky-400 bg-sky-500/10"
                    : "border-white/10 bg-black/40 hover:bg-white/5"
                }`}
              >
                <UploadCloud size={28} strokeWidth={1.8} className="text-slate-300" />
                <span className="sr-only">Seleccionar Excel</span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    void handleBeneficiaryImportFile(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {beneficiaryImportPreview ? (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-slate-300">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Resultado importacion</div>
                  <div className="grid gap-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Archivo</span>
                      <span className="truncate text-right text-white">{beneficiaryImportFileName || "-"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Tipo archivo</span>
                      <span className="text-white">{beneficiaryImportMethodTipo}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Filas leidas</span>
                      <span className="text-white">{beneficiaryImportPreview.totals.rows}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Altas validas</span>
                      <span className="text-emerald-300">{beneficiaryImportPreview.totals.valid}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Errores</span>
                      <span className={beneficiaryImportPreview.totals.errors > 0 ? "text-rose-300" : "text-slate-300"}>{beneficiaryImportPreview.totals.errors}</span>
                    </div>
                  </div>

                  {beneficiaryImportPreview.errorRows.length > 0 ? (
                    <div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-rose-400/10 bg-rose-950/10 p-2">
                      {beneficiaryImportPreview.errorRows.slice(0, 8).map((row) => (
                        <div key={row.rowNumber} className="text-rose-200">
                          Fila {row.rowNumber}: {row.errors.join(" ")}
                        </div>
                      ))}
                      {beneficiaryImportPreview.errorRows.length > 8 ? (
                        <div className="text-slate-500">+ {beneficiaryImportPreview.errorRows.length - 8} error(es) mas.</div>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleCreateBeneficiariesFromPreview}
                    disabled={!beneficiaryImportPreview || beneficiaryImportPreview.validRows.length === 0 || saving}
                    className="mt-3 w-full rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Creando..." : `Crear ${beneficiaryImportPreview.validRows.length} alta(s)`}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
      <div className="space-y-3">
        {selectedBeneficiaryId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0063C4]/30 bg-[#0063C4]/10 px-3 py-2">
            <div>
              <p className="text-[13px] font-normal text-sky-100">Modo agregar metodo</p>
              <p className="text-sm text-slate-300">
                Beneficiario seleccionado: <span className="font-normal text-white">{selectedBeneficiaryName}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={clearWholeForm}
              className="rounded-lg border border-white/10 px-3 py-1 text-[13px] font-normal text-slate-200 transition hover:bg-white/5"
            >
              Cancelar modo agregar
            </button>
          </div>
        ) : null}

        <div className="grid gap-2">
          <div className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white">
            <div className="truncate">
              {clients.find((client) => client.id === clientId)?.label || "Selecciona cliente"}
            </div>
          </div>

          <input
            value={nombre}
            onChange={(e) => setNombre(normalizeNombreInput(e.target.value))}
            placeholder="Nombre del beneficiario"
            disabled={Boolean(selectedBeneficiaryId)}
            className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="grid gap-2">
          <UiSelect
            value={tipo}
            onChange={(nextTipo) => {
              setTipo(nextTipo as FormBeneficiaryTipo);
              setBankCode("");
              setDestinationKind("");
              setClabe("");
              setCardNumber("");
            }}
            options={[
              { value: "DEBITO", label: "DEBITO" },
              { value: "TDC", label: "TDC" },
              { value: "AMEX", label: "AMEX" },
              { value: "EFECTIVO", label: "EFECTIVO" },
            ]}
            placeholder="Tipo"
          />

          {tipo === "AMEX" ? (
            <div className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-slate-300">
              {AMEX_BANK_LABEL}
            </div>
          ) : (
            <UiSelect
              value={bankCode}
              onChange={(nextBankCode) => setBankCode(nextBankCode)}
              disabled={!tipo || tipo === "EFECTIVO"}
              options={sortedBanks.map((bank) => ({
                value: bank.code,
                label: bank.name,
              }))}
              placeholder="Banco"
            />
          )}

          {tipo === "AMEX" ? (
            <div className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-slate-300">
              TARJETA
            </div>
          ) : (
            <UiSelect
              value={destinationKind}
              onChange={(nextDestinationKind) => setDestinationKind(nextDestinationKind as DestinationKind)}
              disabled={!tipo || tipo === "EFECTIVO"}
              options={[
                { value: "CLABE", label: "CLABE" },
                { value: "TARJETA", label: "TARJETA" },
              ]}
              placeholder="Destino"
            />
          )}

          <input
            value={destinationKind === "CLABE" ? clabe : cardNumber}
            onChange={(e) => {
              const digits = onlyDigits(e.target.value);
              if (destinationKind === "CLABE") {
                setClabe(digits.slice(0, 18));
              } else {
                const max = tipo === "AMEX" ? 15 : 16;
                setCardNumber(digits.slice(0, max));
              }
            }}
            disabled={!tipo || tipo === "EFECTIVO" || !destinationKind}
            placeholder={
              !tipo
                ? "Tipo"
                : tipo === "EFECTIVO"
                ? "No aplica"
                : !destinationKind
                ? "Destino"
                : destinationKind === "CLABE"
                ? "CLABE - 18 digitos"
                : tipo === "AMEX"
                ? "Tarjeta - 15 digitos"
                : "Tarjeta - 16 digitos"
            }
            className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={
              canSave
                ? "w-full rounded-xl border border-[#0063C4]/40 bg-[#0063C4]/25 px-4 py-2 text-[13px] font-normal text-sky-100 transition hover:bg-[#0063C4]/35 disabled:opacity-50"
                : "w-full rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[13px] font-normal text-amber-200 transition disabled:cursor-not-allowed disabled:opacity-80"
            }
          >
            {saving
              ? "Guardando..."
              : canSave
                ? selectedBeneficiaryId ? "Guardar metodo" : "Crear beneficiario"
                : "CAMPOS INCOMPLETOS"}
          </button>
        </div>

        {loading ? <p className="text-sm text-slate-400">Cargando...</p> : null}
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      </div>


          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(methodEditDialog)}
        title=""
        onClose={() => {
          if (!methodEditSaving) {
            setMethodEditDialog(null);
          }
        }}
        widthClassName="max-w-[390px]"
      >
        {methodEditDialog ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveMethodEdit();
            }}
          >
            <UiSelect
              value={methodEditDialog.tipo}
              onChange={(nextTipo) => {
                setMethodEditDialog((current) => {
                  if (!current) return current;
                  const typedTipo = nextTipo as BeneficiaryTipo;
                  return {
                    ...current,
                    tipo: typedTipo,
                    bankCode: typedTipo === "EFECTIVO" ? "" : current.bankCode,
                    destinationKind: typedTipo === "EFECTIVO" ? "CLABE" : current.destinationKind,
                    clabe: typedTipo === "EFECTIVO" ? "" : current.clabe,
                    cardNumber: typedTipo === "EFECTIVO" ? "" : current.cardNumber,
                  };
                });
              }}
              options={[
                { value: "DEBITO", label: "DEBITO" },
                { value: "TDC", label: "TDC" },
                { value: "AMEX", label: "AMEX" },
                { value: "EFECTIVO", label: "EFECTIVO" },
              ]}
              placeholder="Tipo"
            />

            <UiSelect
              value={methodEditDialog.bankCode}
              onChange={(nextBankCode) => {
                setMethodEditDialog((current) => (current ? { ...current, bankCode: nextBankCode } : current));
              }}
              disabled={methodEditDialog.tipo === "EFECTIVO"}
              options={sortedBanks.map((bank) => ({
                value: bank.code,
                label: bank.name,
              }))}
              placeholder="Banco"
            />

            <UiSelect
              value={methodEditDialog.destinationKind}
              onChange={(nextDestinationKind) => {
                setMethodEditDialog((current) =>
                  current ? { ...current, destinationKind: nextDestinationKind as DestinationKind } : current
                );
              }}
              disabled={methodEditDialog.tipo === "EFECTIVO"}
              options={[
                { value: "CLABE", label: "CLABE" },
                { value: "TARJETA", label: "TARJETA" },
              ]}
              placeholder="Destino"
            />

            <input
              value={methodEditDialog.destinationKind === "CLABE" ? methodEditDialog.clabe : methodEditDialog.cardNumber}
              onChange={(event) => {
                const digits = onlyDigits(event.target.value);
                setMethodEditDialog((current) => {
                  if (!current) return current;

                  if (current.destinationKind === "CLABE") {
                    return { ...current, clabe: digits.slice(0, 18) };
                  }

                  const max = current.tipo === "AMEX" ? 15 : 16;
                  return { ...current, cardNumber: digits.slice(0, max) };
                });
              }}
              disabled={methodEditDialog.tipo === "EFECTIVO"}
              placeholder={
                methodEditDialog.tipo === "EFECTIVO"
                  ? "No aplica"
                  : methodEditDialog.destinationKind === "CLABE"
                  ? "CLABE - 18 digitos"
                  : methodEditDialog.tipo === "AMEX"
                  ? "Tarjeta - 15 digitos"
                  : "Tarjeta - 16 digitos"
              }
              className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            />

            {methodEditDialog.mode === "REPLACE" ? (
              <UiSelect
                value={methodEditDialog.replacementReason || ""}
                onChange={(nextReason) =>
                  setMethodEditDialog((current) =>
                    current ? { ...current, replacementReason: nextReason } : current
                  )
                }
                disabled={methodEditSaving}
                options={METHOD_CORRECTION_REASONS.map((reason) => ({
                  value: reason.code,
                  label: reason.label,
                }))}
                placeholder="Motivo de correccion"
              />
            ) : null}

            <button
              type="submit"
              disabled={methodEditSaving}
              className="w-full rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {methodEditSaving
                ? "Guardando..."
                : methodEditDialog.mode === "REPLACE"
                  ? "Corregir metodo"
                  : "Guardar metodo"}
            </button>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || "CONFIRMAR"}
        onClose={() => resolveConfirm(false)}
        widthClassName="max-w-[390px]"
      >
        <div className="space-y-0">
          <p className="whitespace-pre-line text-sm leading-6 text-slate-300">{confirmDialog?.message}</p>

          <div className="flex gap-3">
            {!confirmDialog?.hideCancel ? (
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
              >
                Cancelar
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => resolveConfirm(true)}
              className={[
                "rounded-xl px-4 py-3 text-sm font-semibold text-white transition",
                confirmDialog?.hideCancel ? "w-full" : "flex-1",
                confirmDialog?.tone === "danger" ? "bg-rose-600 hover:bg-rose-500" : "bg-blue-500 hover:bg-blue-400",
              ].join(" ")}
            >
              {confirmDialog?.confirmLabel || "Confirmar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(textDialog)}
        title=""
        onClose={() => resolveText(null)}
        widthClassName="max-w-[390px]"
      >
        <form
          className="space-y-0"
          onSubmit={(event) => {
            event.preventDefault();
            resolveText(textDialogValue);
          }}
        >
          <div>
            <label className="sr-only">{textDialog?.label}</label>
            <input
              placeholder={textDialog?.label || ""}
              autoFocus
              value={textDialogValue}
              onChange={(event) => setTextDialogValue(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40"
            />
            {textDialog?.helper ? <p className="mt-2 text-xs text-slate-500">{textDialog.helper}</p> : null}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => resolveText(null)}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400"
            >
              {textDialog?.confirmLabel || "Guardar"}
            </button>
          </div>
        </form>
      </Modal>

      <div className="pay0-table-card space-y-0">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title normal-case tracking-normal">Beneficiarios del cliente</h2>
          <span className="text-[13px] font-normal text-slate-400">{displayedBeneficiaries.length} beneficiarios</span>
        </div>

        <div className="space-y-0">
          {displayedBeneficiaries.map((beneficiary, index) => {
            const rows = groupedMethods[beneficiary.id] || [];
            const expanded = Boolean(expandedBeneficiaries[beneficiary.id]);

            return (
              <div key={beneficiary.id} className={`border-b border-white/10 leading-none ${index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}`}>
                <div className="grid h-[26px] grid-cols-[1fr_110px_105px_132px_34px] items-center gap-2 px-2 py-0">
                  <div>
                    <h3 className="text-[13px] leading-4 text-white">{beneficiary.nombre || "-"}</h3>
                    
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handlePrepareAddMethod(beneficiary)}
                      disabled={saving}
                      className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Agregar metodo"
                      aria-label={`Agregar metodo ${beneficiary.nombre || beneficiary.id}`}
                    >
                      <CirclePlus size={15} strokeWidth={1.8} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleEditBeneficiary(beneficiary)}
                      disabled={!isSuperadmin || saving}
                      className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Editar beneficiario"
                      aria-label={`Editar beneficiario ${beneficiary.nombre || beneficiary.id}`}
                    >
                      <Pencil size={15} strokeWidth={1.8} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteBeneficiary(beneficiary)}
                      disabled={!isSuperadmin || saving}
                      className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Eliminar beneficiario"
                      aria-label={`Eliminar beneficiario ${beneficiary.nombre || beneficiary.id}`}
                    >
                      <Trash2 size={15} strokeWidth={1.8} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleBeneficiary(beneficiary)}
                      disabled={saving}
                      className={`inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${beneficiary.active ? "hover:text-rose-500" : "hover:text-emerald-400"}`}
                      title={beneficiary.active ? "Desactivar beneficiario" : "Activar beneficiario"}
                      aria-label={`${beneficiary.active ? "Desactivar" : "Activar"} beneficiario ${beneficiary.nombre || beneficiary.id}`}
                    >
                      {beneficiary.active ? <PowerOff size={15} strokeWidth={1.8} /> : <Power size={15} strokeWidth={1.8} />}
                    </button>
                  </div>

                  <div className="text-[11px] leading-4 text-slate-400">
                    {beneficiary.active ? "Activo" : "Inactivo"}
                  </div>

                  <div className="text-[11px] leading-4 text-slate-400">
                    {rows.length} metodo{rows.length === 1 ? "" : "s"}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBeneficiaries((prev) => ({
                        ...prev,
                        [beneficiary.id]: !prev[beneficiary.id],
                      }))
                    }
                    className="inline-flex items-center justify-center p-1 text-slate-500 transition hover:text-white"
                    title={expanded ? "Ocultar metodos" : "Ver metodos"}
                    aria-label={expanded ? "Ocultar metodos" : "Ver metodos"}
                  >
                    <ChevronDown
                      size={16}
                      className={`transition-transform duration-200 ${expanded ? "rotate-180 text-slate-200" : "text-slate-600"}`}
                    />
                  </button>
                </div>

                <div className={expanded ? "pay0-table-wrap px-2 pb-1" : "hidden"}>
                  <table className="pay0-table min-w-[900px] [&_td]:py-1 [&_th]:py-1">
                    <thead>
                      <tr className="pay0-table-head-row">
                        <th className="pay0-th w-[90px]">Tipo</th>
                        <th className="pay0-th w-[170px]">Banco</th>
                        <th className="pay0-th w-[210px]">CLABE</th>
                        <th className="pay0-th w-[180px]">Tarjeta</th>
                        <th className="pay0-th w-[110px]">Estatus</th>
                        <th className="pay0-th w-[80px] text-center">ACC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, methodIndex) => (
                        <tr key={row.id} className={methodIndex % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}>
                          <td className="pay0-td">{row.tipo || "-"}</td>
                          <td className="pay0-td">{row.bankName || "-"}</td>
                          <td className="pay0-td-date">{row.clabe || "-"}</td>
                          <td className="pay0-td-date">{row.cardNumber || "-"}</td>
                          <td className="pay0-td">
                            {isMethodReplaced(row) ? "Reemplazado" : row.active ? "Activo" : "Inactivo"}
                          </td>
                          <td className="pay0-td text-center">
                            <div className="inline-flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditMethod(row)}
                                disabled={!isSuperadmin || saving || methodEditSaving || isMethodReplaced(row)}
                                className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Editar metodo"
                                aria-label={`Editar metodo ${row.tipo || row.id}`}
                              >
                                <Pencil size={15} strokeWidth={1.8} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleEditMethod(row, "REPLACE")}
                                disabled={!isSuperadmin || saving || methodEditSaving || isMethodReplaced(row)}
                                className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Corregir metodo"
                                aria-label={`Corregir metodo ${row.tipo || row.id}`}
                              >
                                <Wrench size={15} strokeWidth={1.8} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteMethod(row)}
                                disabled={!isSuperadmin || saving || methodEditSaving || isMethodReplaced(row)}
                                className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Eliminar metodo"
                                aria-label={`Eliminar metodo ${row.tipo || row.id}`}
                              >
                                <Trash2 size={15} strokeWidth={1.8} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleMethod(row)}
                                disabled={saving || methodEditSaving || isMethodReplaced(row)}
                                className={`inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${row.active ? "hover:text-rose-500" : "hover:text-emerald-400"}`}
                                title={row.active ? "Desactivar metodo" : "Activar metodo"}
                                aria-label={`${row.active ? "Desactivar" : "Activar"} metodo ${row.tipo || row.id}`}
                              >
                                {row.active ? <PowerOff size={15} strokeWidth={1.8} /> : <Power size={15} strokeWidth={1.8} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="pay0-empty-cell">
                            Sin metodos guardados.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {!clientId ? (
            <div className="pay0-empty-cell">
              Selecciona cliente.
            </div>
          ) : displayedBeneficiaries.length === 0 ? (
            <div className="pay0-empty-cell">
              {beneficiarySearch.trim() ? "Sin coincidencias para este filtro." : "Sin beneficiarios."}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
