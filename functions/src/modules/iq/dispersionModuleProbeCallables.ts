import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { DEFAULT_IQ_ERP_URL } from "./config";
import { assertIqAuthorized } from "./authorization";
import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
} from "./iqHttpAuth";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const PROBE_VERSION = "H4-D82-A1-IQ1";

type AnyRecord = Record<string, unknown>;

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function record(value: unknown): AnyRecord {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

function normalizeErpUrl(value: string): string {
  const raw =
    clean(value) || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ tiene una URL ERP invalida.",
    );
  }
}

function getEncryptionKey(): Buffer {
  const raw = IQ_CREDENTIALS_KEY.value();

  if (
    !raw ||
    raw.trim().length < 16
  ) {
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada.",
    );
  }

  const trimmed = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(
      trimmed,
      "hex",
    );
  }

  try {
    const decoded = Buffer.from(
      trimmed,
      "base64",
    );

    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fallback SHA-256 below.
  }

  return crypto
    .createHash("sha256")
    .update(trimmed)
    .digest();
}

function decryptSecret(
  data: AnyRecord,
): string {
  const ciphertext = clean(
    data.passwordCiphertext,
  );
  const iv = clean(data.passwordIv);
  const tag = clean(data.passwordTag);

  if (
    !ciphertext ||
    !iv ||
    !tag
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene contrasena configurada.",
    );
  }

  const decipher =
    crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(iv, "base64"),
    );

  decipher.setAuthTag(
    Buffer.from(tag, "base64"),
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(
        ciphertext,
        "base64",
      ),
    ),
    decipher.final(),
  ]).toString("utf8");
}

async function requireSuperadmin(
  request: {
    auth?: {
      uid?: string;
      token?: AnyRecord;
    } | null;
  },
) {
  await assertIqAuthorized(
    request,
    {
      allowedRoles: [
        "superadmin",
      ],
    },
  );

  const uid = clean(
    request.auth?.uid,
  );

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Sesion requerida.",
    );
  }

  const userSnap = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Usuario PAY0 no encontrado.",
    );
  }

  const user = record(
    userSnap.data(),
  );
  const role = clean(
    request.auth?.token?.role ??
    user.role,
  ).toLowerCase();
  const rootId =
    clean(
      request.auth?.token?.rootId ??
      user.rootId ??
      uid,
    ) || uid;

  if (role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo Super Admin puede explorar el modulo IQ de dispersiones.",
    );
  }

  return {
    uid,
    rootId,
  };
}

async function loadIqAccess(
  uid: string,
  rootId: string,
) {
  const accessSnap = await db
    .collection("iqUserAccess")
    .doc(uid)
    .get();
  const access = record(
    accessSnap.data(),
  );

  if (
    !accessSnap.exists ||
    access.active !== true ||
    access.iqEnabled !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El Super Admin no tiene acceso IQ activo.",
    );
  }

  const profileId = clean(
    access.iqCredentialProfileId,
  );

  if (!profileId) {
    throw new HttpsError(
      "failed-precondition",
      "El acceso IQ no tiene perfil de credenciales asignado.",
    );
  }

  const profileSnap = await db
    .collection(
      "iqCredentialProfiles",
    )
    .doc(profileId)
    .get();

  if (!profileSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "El perfil de credenciales IQ no existe.",
    );
  }

  const profile = record(
    profileSnap.data(),
  );

  if (
    clean(profile.rootId) !== rootId ||
    profile.active !== true ||
    profile.hasPassword !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El perfil IQ esta inactivo o fuera de scope.",
    );
  }

  const username = clean(
    profile.username,
  );

  if (!username) {
    throw new HttpsError(
      "failed-precondition",
      "El perfil IQ no tiene usuario configurado.",
    );
  }

  return {
    profileId,
    profileAlias:
      clean(profile.alias) ||
      profileId,
    associatedName: clean(
      access.associatedName,
    ),
    username,
    password:
      decryptSecret(profile),
    erpUrl: normalizeErpUrl(
      clean(profile.erpUrl),
    ),
  };
}

type IqProbeHttpPageA56 = {
  path: string;
  title: string;
  httpStatus: number;
  bodySnippet: string;
  formsCount: number;
  tablesCount: number;
  fields: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
};

function normalizeProbeNameA56(
  value: unknown,
): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function asProbeRowsA56(
  value: unknown,
): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (
          row,
        ): row is Record<string, unknown> =>
          Boolean(row) &&
          typeof row === "object" &&
          !Array.isArray(row),
      )
    : [];
}

function probeRowTextA56(
  row: Record<string, unknown>,
): string {
  return clean(
    row.name ??
    row.label ??
    row.description ??
    row.value ??
    row.client_name,
  );
}

function probeRowIdA56(
  row: Record<string, unknown>,
): string {
  return clean(
    row.id ??
    row.partner_id ??
    row.client_id ??
    row.operation_type_id ??
    row.sale_percentage_id,
  );
}

async function probeGetJsonA56(
  session: IqHttpAuthSession,
  path: string,
): Promise<{
  path: string;
  status: number;
  body: Record<string, unknown>;
  contentType: string;
}> {
  const response = await fetch(
    new URL(path, session.apiOrigin),
    {
      method: "GET",
      headers: {
        Authorization:
          `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const contentType =
    clean(
      response.headers.get(
        "content-type",
      ),
    );

  let body: Record<string, unknown> = {};

  try {
    const value =
      await response.json();

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      body =
        value as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  return {
    path,
    status: response.status,
    body,
    contentType,
  };
}

function probeFieldA56(
  index: number,
  label: string,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    tag: "combobox",
    type: "http-read-only-probe",
    name: `dropdown-${index}`,
    id: `dropdown-${index}`,
    placeholder: "",
    label,
    required: false,
    disabled: false,
    options: rows
      .map((row) =>
        probeRowTextA56(row),
      )
      .filter(Boolean)
      .slice(0, 250),
  };
}

async function runIqDispersionReadOnlyHttpProbeA56(
  input: {
    erpUrl: string;
    username: string;
    password: string;
    associatedName?: string;
  },
): Promise<any> {
  const apiOrigin =
    clean(
      process.env.PAY0_IQ_API_ORIGIN,
    ) ||
    "https://iq-produccion-ccc570f75402.herokuapp.com";

  try {
    const session =
      await loginIqHttpDirect({
        apiOrigin,
        credentials: {
          username:
            clean(input.username),
          password:
            clean(input.password),
        },
        requiredPermissions: "NONE",
      });

    const initial =
      await probeGetJsonA56(
        session,
        "/dispersions/new",
      );

    if (initial.status !== 200) {
      throw new Error(
        `IQ_DISPERSION_WIZARD_HTTP_${initial.status}`,
      );
    }

    const partners =
      asProbeRowsA56(
        initial.body.partners,
      );

    const wanted =
      normalizeProbeNameA56(
        input.associatedName,
      );

    const partnerMatches =
      wanted
        ? partners.filter(
            (row) =>
              normalizeProbeNameA56(
                probeRowTextA56(row),
              ) === wanted,
          )
        : partners;

    const partner =
      partnerMatches.length === 1
        ? partnerMatches[0]
        : partners.length === 1
          ? partners[0]
          : null;

    let detailed = initial;
    let selectedPartnerText = "";

    if (partner) {
      const partnerId =
        probeRowIdA56(partner);

      selectedPartnerText =
        probeRowTextA56(partner);

      if (partnerId) {
        detailed =
          await probeGetJsonA56(
            session,
            `/dispersions/new?partner_id=${
              encodeURIComponent(
                partnerId,
              )
            }`,
          );

        if (detailed.status !== 200) {
          throw new Error(
            `IQ_DISPERSION_WIZARD_PARTNER_HTTP_${detailed.status}`,
          );
        }
      }
    }

    const payload =
      detailed.body;

    const clients =
      asProbeRowsA56(
        payload.clients,
      );
    const currencies =
      asProbeRowsA56(
        payload.currencies,
      );
    const operationTypes =
      asProbeRowsA56(
        payload.operation_types,
      );
    const salePercentages =
      asProbeRowsA56(
        payload.sale_percentages,
      );

    const fields: Array<
      Record<string, unknown>
    > = [
      probeFieldA56(
        0,
        "Asociado",
        partners,
      ),
      probeFieldA56(
        1,
        "Cliente",
        clients,
      ),
      probeFieldA56(
        2,
        "Moneda",
        currencies,
      ),
      probeFieldA56(
        3,
        "Tipo de operacion",
        operationTypes,
      ),
      probeFieldA56(
        4,
        "Porcentaje",
        salePercentages,
      ),
    ];

    const formPage:
      IqProbeHttpPageA56 = {
        path:
          "/dispersions#create-form",
        title:
          "Crear dispersion | MAPEO HTTP SOLO LECTURA",
        httpStatus:
          detailed.status,
        bodySnippet:
          "Wizard de dispersiones inspeccionado por HTTP directo.",
        formsCount: 1,
        tablesCount: 0,
        fields,
        actions: [],
      };

    // H4_D87_A58_A66_REAL_DISPERSION_LIST_STATUS_PROBE
    const listResponse =
      await probeGetJsonA56(
        session,
        "/dispersions",
      );

    if (listResponse.status !== 200) {
      throw new Error(
        `IQ_DISPERSION_LIST_HTTP_${listResponse.status}`,
      );
    }

    const listBody =
      listResponse.body;

    const rawListRows =
      Array.isArray(listBody.dispersions)
        ? listBody.dispersions
        : Array.isArray(listBody.rows)
          ? listBody.rows
          : Array.isArray(listBody.data)
            ? listBody.data
            : [];

    const dispersionStatusRows =
      rawListRows
        .filter(
          (
            row,
          ): row is Record<string, unknown> =>
            Boolean(row) &&
            typeof row === "object" &&
            !Array.isArray(row),
        )
        .slice(0, 25)
        .map((row) => ({
          id:
            clean(row.id) ||
            null,
          created_at:
            clean(
              row.created_at ??
              row.createdAt,
            ) ||
            null,
          operation_status:
            clean(
              row.operation_status ??
              row.operationStatus,
            ) ||
            null,
          conciliation_status:
            clean(
              row.conciliation_status ??
              row.conciliationStatus,
            ) ||
            null,
        }));

    const listPage:
      IqProbeHttpPageA56 = {
        path: "/dispersions",
        title:
          "Dispersiones IQ | HTTP READ ONLY",
        httpStatus:
          listResponse.status,
        bodySnippet:
          `Listado real IQ inspeccionado por HTTP directo. Filas observadas: ${dispersionStatusRows.length}.`,
        formsCount: 0,
        tablesCount: 1,
        fields: [],
        actions: [],
      };

    const networkGetPaths = [
      {
        path:
          "/dispersions/new",
        status: initial.status,
        contentType:
          initial.contentType,
      },
      {
        path:
          "/dispersions",
        status:
          listResponse.status,
        contentType:
          listResponse.contentType,
      },
    ];

    if (
      detailed.path !==
      initial.path
    ) {
      networkGetPaths.push({
        path: detailed.path,
        status: detailed.status,
        contentType:
          detailed.contentType,
      });
    }

    return {
      authenticated: true,
      loginStatus:
        "IQ_AUTHENTICATED",
      loginMessage:
        "Sesion IQ confirmada. Wizard /dispersions/new inspeccionado por HTTP directo sin submit.",
      landingPath:
        "/dispersions",
      candidateLinks: [
        {
          path: "/dispersions",
          text:
            "Modulo real de dispersiones IQ",
          score: 100,
        },
      ],
      pages: [
        listPage,
        formPage,
      ],
      dispersionStatusRows,
      networkGetPaths,
      blockedNonGetRequests: [],
      dropdownSelections:
        selectedPartnerText
          ? [
              {
                index: 0,
                selected: true,
                text:
                  selectedPartnerText,
              },
            ]
          : [],
      transport:
        "HTTP_DIRECT",
    };
  } catch (error) {
    const message =
      clean(
        error instanceof Error
          ? error.message
          : error,
      ) ||
      "IQ_DISPERSION_HTTP_PROBE_ERROR";

    return {
      authenticated: false,
      loginStatus:
        message.startsWith(
          "IQ_AUTH_HTTP_",
        )
          ? "IQ_LOGIN_REJECTED"
          : "IQ_LOGIN_FAILED",
      loginMessage:
        `No se pudo inspeccionar dispersiones IQ por HTTP directo: ${message}`,
      landingPath:
        "/dispersions",
      candidateLinks: [],
      pages: [],
      networkGetPaths: [],
      blockedNonGetRequests: [],
      dropdownSelections: [],
      transport:
        "HTTP_DIRECT",
    };
  }
}

// H4_D87_A56_A5_HTTP_DISPERSION_PROBE
export const probeIqDispersionModule =
  onCall(
    {
      cors: true,
      timeoutSeconds: 180,
      memory: "1GiB",
      maxInstances: 1,
      concurrency: 1,
      secrets: [
        IQ_CREDENTIALS_KEY,
      ],
    },
    async (request) => {
      const auth =
        await requireSuperadmin(
          request,
        );
      const access =
        await loadIqAccess(
          auth.uid,
          auth.rootId,
        );

      const probe =
        await runIqDispersionReadOnlyHttpProbeA56({
          erpUrl: access.erpUrl,
          username: access.username,
          password: access.password,
          associatedName:
            access.associatedName,
        });

      if (!probe.authenticated) {
        throw new HttpsError(
          "failed-precondition",
          `${probe.loginMessage} Estado: ${probe.loginStatus}. Ruta: ${probe.landingPath}.`,
        );
      }

      return {
        ok: true,
        data: {
          version: PROBE_VERSION,
          mode: "READ_ONLY",
          businessWrites: 0,
          submitAfterLogin: false,
          profileId:
            access.profileId,
          profileAlias:
            access.profileAlias,
          associatedName:
            access.associatedName ||
            null,
          ...probe,
        },
        message:
          "Mapeo dinamico IQ terminado por HTTP directo. Se inspecciono el wizard de dispersiones; no se capturo monto ni se hizo submit.",
      };
    },
  );
