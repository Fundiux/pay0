import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "@/lib/firebase";

const functions = getFunctions();

function createdAtMillis(value: any) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortBeneficiaryRowsNewestFirst<T extends { id: string; createdAt?: any }>(rows: T[]) {
  return [...rows].sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt) || a.id.localeCompare(b.id));
}

export type BeneficiaryTipo = "DEBITO" | "TDC" | "AMEX" | "OTRO" | "EFECTIVO";
export type DestinationKind = "CLABE" | "TARJETA" | "EFECTIVO";

export interface ClientBeneficiaryRow {
  id: string;
  rootId?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  createdBy?: string | null;
  clientId?: string | null;
  clienteId?: string | null;
  nombre?: string | null;
  nombreNormalizado?: string | null;
  active?: boolean;
  methodCount?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface ClientBeneficiaryMethodRow {
  id: string;
  beneficiaryId?: string | null;
  clientId?: string | null;
  clienteId?: string | null;
  tipo?: BeneficiaryTipo | null;
  destinationKind?: DestinationKind | null;
  bankCode?: string | null;
  bankName?: string | null;
  clabe?: string | null;
  cardNumber?: string | null;
  last4?: string | null;
  masked?: string | null;
  dedupeKey?: string | null;
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface BeneficiaryMethodInput {
  tipo: BeneficiaryTipo;
  bankCode?: string;
  bankName?: string;
  clabe?: string;
  cardNumber?: string;
}

export interface CreateClientBeneficiaryInput {
  clientId: string;
  nombre: string;
  methods: BeneficiaryMethodInput[];
}

export interface UpdateClientBeneficiaryInput {
  beneficiaryId: string;
  nombre: string;
}

export interface UpdateClientBeneficiaryMethodInput {
  methodId: string;
  tipo: BeneficiaryTipo;
  bankCode?: string;
  bankName?: string;
  clabe?: string;
  cardNumber?: string;
}

export interface ReplaceClientBeneficiaryMethodInput extends UpdateClientBeneficiaryMethodInput {
  replacementReason: string;
}

export interface DeleteClientBeneficiaryInput {
  beneficiaryId: string;
}

export interface DeleteClientBeneficiaryMethodInput {
  methodId: string;
}

export async function createClientBeneficiary(input: CreateClientBeneficiaryInput) {
  const callable = httpsCallable<CreateClientBeneficiaryInput, { ok: boolean; beneficiaryId: string; methodsCreated: number }>(
    functions,
    "createClientBeneficiary"
  );
  const result = await callable(input);
  return result.data;
}

export async function addClientBeneficiaryMethod(input: {
  beneficiaryId: string;
  tipo: BeneficiaryTipo;
  bankCode?: string;
  bankName?: string;
  clabe?: string;
  cardNumber?: string;
}) {
  const callable = httpsCallable<typeof input, { ok: boolean; beneficiaryId: string; methodId: string }>(
    functions,
    "addClientBeneficiaryMethod"
  );
  const result = await callable(input);
  return result.data;
}

export async function updateClientBeneficiary(input: UpdateClientBeneficiaryInput) {
  const callable = httpsCallable<UpdateClientBeneficiaryInput, { ok: boolean; beneficiaryId: string }>(
    functions,
    "updateClientBeneficiary"
  );
  const result = await callable(input);
  return result.data;
}

export async function deleteClientBeneficiary(input: DeleteClientBeneficiaryInput) {
  const callable = httpsCallable<DeleteClientBeneficiaryInput, { ok: boolean; beneficiaryId: string; methodsDeleted: number }>(
    functions,
    "deleteClientBeneficiary"
  );
  const result = await callable(input);
  return result.data;
}

export async function updateClientBeneficiaryMethod(input: UpdateClientBeneficiaryMethodInput) {
  const callable = httpsCallable<
    UpdateClientBeneficiaryMethodInput,
    { ok: boolean; oldMethodId: string; methodId: string; replacedDocument: boolean }
  >(functions, "updateClientBeneficiaryMethod");
  const result = await callable(input);
  return result.data;
}

export async function replaceClientBeneficiaryMethod(input: ReplaceClientBeneficiaryMethodInput) {
  const callable = httpsCallable<
    ReplaceClientBeneficiaryMethodInput,
    { ok: boolean; oldMethodId: string; methodId: string; replacementOfMethodId: string; replacedDocument: boolean }
  >(functions, "replaceClientBeneficiaryMethod");
  const result = await callable(input);
  return result.data;
}

export async function deleteClientBeneficiaryMethod(input: DeleteClientBeneficiaryMethodInput) {
  const callable = httpsCallable<DeleteClientBeneficiaryMethodInput, { ok: boolean; methodId: string; beneficiaryId: string }>(
    functions,
    "deleteClientBeneficiaryMethod"
  );
  const result = await callable(input);
  return result.data;
}

export async function toggleClientBeneficiaryActive(input: { beneficiaryId: string; active: boolean }) {
  const callable = httpsCallable<typeof input, { ok: boolean; beneficiaryId: string; active: boolean }>(
    functions,
    "toggleClientBeneficiaryActive"
  );
  const result = await callable(input);
  return result.data;
}

export async function toggleClientBeneficiaryMethodActive(input: { methodId: string; active: boolean }) {
  const callable = httpsCallable<typeof input, { ok: boolean; methodId: string; active: boolean }>(
    functions,
    "toggleClientBeneficiaryMethodActive"
  );
  const result = await callable(input);
  return result.data;
}

export function watchClientBeneficiaries(
  clientId: string,
  onData: (rows: ClientBeneficiaryRow[]) => void,
  onError?: (error: Error) => void
) {
  const q = query(
    collection(db, "clientBeneficiaries"),
    where("clientId", "==", clientId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const rows: ClientBeneficiaryRow[] = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<ClientBeneficiaryRow, "id">),
      }));
      onData(sortBeneficiaryRowsNewestFirst(rows));
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export function watchClientBeneficiaryMethods(
  clientId: string,
  onData: (rows: ClientBeneficiaryMethodRow[]) => void,
  onError?: (error: Error) => void
) {
  const q = query(
    collection(db, "clientBeneficiaryMethods"),
    where("clientId", "==", clientId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const rows: ClientBeneficiaryMethodRow[] = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<ClientBeneficiaryMethodRow, "id">),
      }));
      onData(sortBeneficiaryRowsNewestFirst(rows));
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}
