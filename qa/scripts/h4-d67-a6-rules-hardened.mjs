import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  getBytes,
  ref,
  uploadBytes,
} from "firebase/storage";

const root = process.cwd();
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "pay0-system-rules-hardened";

const reportPath =
  process.env.PAY0_RULES_REPORT_PATH ||
  path.join(root, "audit", "H4-D67-A6-rules-report.json");

const firestoreRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8",
);

const storageRules = fs.readFileSync(
  path.join(root, "storage.rules"),
  "utf8",
);

const results = [];

function record(name, status, detail = "") {
  results.push({ name, status, detail });
}

async function test(name, action) {
  try {
    await action();
    record(name, "PASS");
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    record(name, "FAIL", detail);
    console.error(`FAIL ${name}`);
    console.error(detail);
    throw error;
  }
}

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        block: "H4-D67-A6",
        generatedAt: new Date().toISOString(),
        projectId,
        total: results.length,
        passed: results.filter((item) => item.status === "PASS").length,
        failed: results.filter((item) => item.status === "FAIL").length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
}

const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: firestoreRules,
  },
  storage: {
    rules: storageRules,
  },
});

try {
  await env.clearFirestore();
  await env.clearStorage();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    const users = [
      ["superA", { role: "superadmin", rootId: "rootA" }],
      ["adminA", { role: "admin", rootId: "rootA" }],
      ["delegatedA", { role: "operador", rootId: "rootA" }],
      ["sameRootA", { role: "operador", rootId: "rootA" }],
      ["otherRootB", { role: "operador", rootId: "rootB" }],
    ];

    for (const [uid, data] of users) {
      await setDoc(doc(db, "users", uid), data);
    }

    await setDoc(
      doc(
        db,
        "userClientAccess",
        "delegatedA",
        "clients",
        "clientA",
      ),
      {
        active: true,
        rootId: "rootA",
        permissions: {
          view: true,
          operate: true,
          operateSolicitudes: true,
          operatePagos: true,
          operateDispersiones: true,
        },
      },
    );

    await setDoc(doc(db, "solicitudes", "solA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
      companyId: "companyA",
      monto: 100,
    });

    await setDoc(doc(db, "solicitudes", "solB"), {
      rootId: "rootA",
      clientId: "clientB",
      clienteId: "clientB",
      adminId: "adminA",
      createdBy: "adminA",
      companyId: "companyA",
      monto: 100,
    });

    await setDoc(
      doc(db, "solicitudes", "solA", "notas", "notaA"),
      {
        rootId: "rootA",
        text: "nota",
        createdBy: "adminA",
      },
    );

    await setDoc(doc(db, "pagos", "pagoA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
      companyId: "companyA",
      monto: 100,
    });

    await setDoc(doc(db, "pagos", "pagoB"), {
      rootId: "rootA",
      clientId: "clientB",
      clienteId: "clientB",
      adminId: "adminA",
      createdBy: "adminA",
      companyId: "companyA",
      monto: 100,
    });

    await setDoc(
      doc(db, "pagos", "pagoA", "notas", "notaA"),
      {
        rootId: "rootA",
        text: "nota",
        createdBy: "adminA",
      },
    );

    await setDoc(doc(db, "clientDispersions", "dispA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
      monto: 10,
    });

    const uploads = [
      [
        "upSolAdmin",
        {
          rootId: "rootA",
          entityType: "solicitudes",
          entityId: "solA",
          createdBy: "adminA",
          status: "PENDING",
          storagePath:
            "roots/rootA/solicitudes/solA/docs/ORDEN_COMPRA/upSolAdmin-oc.xlsx",
        },
      ],
      [
        "upSolDelegated",
        {
          rootId: "rootA",
          entityType: "solicitudes",
          entityId: "solA",
          createdBy: "delegatedA",
          status: "PENDING",
          storagePath:
            "roots/rootA/solicitudes/solA/docs/OTRO/upSolDelegated-evidencia.txt",
        },
      ],
      [
        "upSolIntruder",
        {
          rootId: "rootA",
          entityType: "solicitudes",
          entityId: "solA",
          createdBy: "sameRootA",
          status: "PENDING",
          storagePath:
            "roots/rootA/solicitudes/solA/docs/OTRO/upSolIntruder-intruso.txt",
        },
      ],
      [
        "upPagoDelegated",
        {
          rootId: "rootA",
          entityType: "pagos",
          entityId: "pagoA",
          createdBy: "delegatedA",
          status: "PENDING",
          storagePath:
            "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/upPagoDelegated-comprobante.pdf",
        },
      ],
      [
        "upDispDelegated",
        {
          rootId: "rootA",
          entityType: "clientDispersions",
          entityId: "dispA",
          createdBy: "delegatedA",
          status: "PENDING",
          storagePath:
            "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/upDispDelegated-comprobante.pdf",
        },
      ],
    ];

    for (const [uploadId, data] of uploads) {
      await setDoc(doc(db, "uploads", uploadId), data);
    }

    await setDoc(doc(db, "entityDocuments", "entityDocA"), {
      id: "entityDocA",
      rootId: "rootA",
      entityType: "CLIENTE",
      entityId: "clientA",
      documentType: "CONSTANCIA_SITUACION_FISCAL",
      createdBy: "superA",
      uploadStatus: "PENDING_UPLOAD",
      storagePath:
        "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/entityDocA-csf.pdf",
    });

    const storage = context.storage();

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/solicitudes/solA/docs/ORDEN_COMPRA/existente.xlsx",
      ),
      new Uint8Array([80, 65, 89, 48]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/existente.pdf",
      ),
      new Uint8Array([37, 80, 68, 70]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/existente.pdf",
      ),
      new Uint8Array([37, 80, 68, 70]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/existente.pdf",
      ),
      new Uint8Array([37, 80, 68, 70]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/otroModulo/otraEntidad/privado.txt",
      ),
      new Uint8Array([1, 2, 3]),
    );
  });

  const anonymousDb = env.unauthenticatedContext().firestore();
  const superDb = env.authenticatedContext("superA").firestore();
  const adminDb = env.authenticatedContext("adminA").firestore();
  const delegatedDb = env.authenticatedContext("delegatedA").firestore();
  const sameRootDb = env.authenticatedContext("sameRootA").firestore();

  await test(
    "Firestore bloquea lectura anonima de Solicitudes",
    async () => {
      await assertFails(
        getDoc(doc(anonymousDb, "solicitudes", "solA")),
      );
    },
  );

  await test(
    "Firestore permite al superadmin leer Solicitudes",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(superDb, "solicitudes", "solA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Firestore permite al creador leer su Solicitud",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(adminDb, "solicitudes", "solA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Delegacion activa permite leer Solicitudes del cliente autorizado",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(delegatedDb, "solicitudes", "solA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Delegacion activa no permite leer Solicitudes de otro cliente",
    async () => {
      await assertFails(
        getDoc(doc(delegatedDb, "solicitudes", "solB")),
      );
    },
  );

  await test(
    "Delegacion activa permite leer Pagos del cliente autorizado",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(delegatedDb, "pagos", "pagoA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Delegacion activa no permite leer Pagos de otro cliente",
    async () => {
      await assertFails(
        getDoc(doc(delegatedDb, "pagos", "pagoB")),
      );
    },
  );

  await test(
    "Delegacion activa permite leer notas de Solicitudes",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(
          doc(
            delegatedDb,
            "solicitudes",
            "solA",
            "notas",
            "notaA",
          ),
        ),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Delegacion activa permite crear nota en Solicitud autorizada",
    async () => {
      await assertSucceeds(
        setDoc(
          doc(
            delegatedDb,
            "solicitudes",
            "solA",
            "notas",
            "notaDelegada",
          ),
          {
            rootId: "rootA",
            text: "seguimiento delegado",
            createdBy: "delegatedA",
          },
        ),
      );
    },
  );

  await test(
    "Delegacion activa permite leer notas de Pagos",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(
          doc(
            delegatedDb,
            "pagos",
            "pagoA",
            "notas",
            "notaA",
          ),
        ),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Firestore mantiene bloqueada escritura directa de Solicitudes",
    async () => {
      await assertFails(
        setDoc(doc(delegatedDb, "solicitudes", "directWrite"), {
          rootId: "rootA",
          clientId: "clientA",
          createdBy: "delegatedA",
          monto: 1,
        }),
      );
    },
  );

  await test(
    "Usuario del mismo root sin asignacion no puede leer Solicitudes",
    async () => {
      await assertFails(
        getDoc(doc(sameRootDb, "solicitudes", "solA")),
      );
    },
  );

  const anonymousStorage = env.unauthenticatedContext().storage();
  const superStorage = env.authenticatedContext("superA").storage();
  const adminStorage = env.authenticatedContext("adminA").storage();
  const delegatedStorage =
    env.authenticatedContext("delegatedA").storage();
  const sameRootStorage =
    env.authenticatedContext("sameRootA").storage();
  const otherRootStorage =
    env.authenticatedContext("otherRootB").storage();

  const solicitudExisting =
    "roots/rootA/solicitudes/solA/docs/ORDEN_COMPRA/existente.xlsx";
  const pagoExisting =
    "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/existente.pdf";
  const dispersionExisting =
    "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/existente.pdf";
  const entityExisting =
    "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/existente.pdf";
  const unknownExisting =
    "roots/rootA/otroModulo/otraEntidad/privado.txt";

  await test(
    "Storage bloquea lectura anonima",
    async () => {
      await assertFails(
        getBytes(ref(anonymousStorage, solicitudExisting)),
      );
    },
  );

  await test(
    "Creador puede leer documentos de su Solicitud",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(adminStorage, solicitudExisting)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Delegado puede leer documentos de Solicitud autorizada",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(delegatedStorage, solicitudExisting)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Delegado puede leer comprobante de Pago autorizado",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(delegatedStorage, pagoExisting)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Delegado puede leer comprobante de Dispersion autorizada",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(delegatedStorage, dispersionExisting)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Usuario ordinario del mismo root no puede leer documentos ajenos",
    async () => {
      await assertFails(
        getBytes(ref(sameRootStorage, solicitudExisting)),
      );
    },
  );

  await test(
    "Ruta general no declarada queda cerrada incluso dentro del mismo root",
    async () => {
      await assertFails(
        getBytes(ref(sameRootStorage, unknownExisting)),
      );
    },
  );

  await test(
    "Storage bloquea acceso cruzado entre roots",
    async () => {
      await assertFails(
        getBytes(ref(otherRootStorage, solicitudExisting)),
      );
    },
  );

  await test(
    "Superadmin puede leer papeleria fiscal",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(superStorage, entityExisting)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Usuario ordinario del mismo root no puede leer papeleria fiscal",
    async () => {
      await assertFails(
        getBytes(ref(sameRootStorage, entityExisting)),
      );
    },
  );

  await test(
    "Upload preparado permite al creador subir documento de Solicitud",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            adminStorage,
            "roots/rootA/solicitudes/solA/docs/ORDEN_COMPRA/upSolAdmin-oc.xlsx",
          ),
          new Uint8Array([1, 2, 3]),
          {
            customMetadata: {
              uploadId: "upSolAdmin",
            },
          },
        ),
      );
    },
  );

  await test(
    "Upload preparado permite al delegado subir documento autorizado",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/solicitudes/solA/docs/OTRO/upSolDelegated-evidencia.txt",
          ),
          new Uint8Array([1, 2, 3]),
          {
            customMetadata: {
              uploadId: "upSolDelegated",
            },
          },
        ),
      );
    },
  );

  await test(
    "Upload preparado de Pago funciona para delegado autorizado",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/upPagoDelegated-comprobante.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
          {
            customMetadata: {
              uploadId: "upPagoDelegated",
            },
          },
        ),
      );
    },
  );

  await test(
    "Upload preparado de Dispersion funciona para delegado autorizado",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/upDispDelegated-comprobante.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
          {
            customMetadata: {
              uploadId: "upDispDelegated",
            },
          },
        ),
      );
    },
  );

  await test(
    "Usuario sin acceso no puede usar un upload preparado de Solicitud",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            sameRootStorage,
            "roots/rootA/solicitudes/solA/docs/OTRO/upSolIntruder-intruso.txt",
          ),
          new Uint8Array([1, 2, 3]),
          {
            customMetadata: {
              uploadId: "upSolIntruder",
            },
          },
        ),
      );
    },
  );

  await test(
    "No se puede subir sin uploadId preparado",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/solicitudes/solA/docs/OTRO/sin-preparacion.txt",
          ),
          new Uint8Array([1, 2, 3]),
        ),
      );
    },
  );

  await test(
    "No se puede reutilizar uploadId en otra ruta",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/solicitudes/solA/docs/OTRO/ruta-distinta.txt",
          ),
          new Uint8Array([1, 2, 3]),
          {
            customMetadata: {
              uploadId: "upSolDelegated",
            },
          },
        ),
      );
    },
  );

  await test(
    "Storage bloquea documentos operativos mayores a 1 MB",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            delegatedStorage,
            "roots/rootA/solicitudes/solA/docs/OTRO/upSolDelegated-evidencia.txt",
          ),
          new Uint8Array(1024 * 1024 + 1),
          {
            customMetadata: {
              uploadId: "upSolDelegated",
            },
          },
        ),
      );
    },
  );

  await test(
    "Superadmin puede subir papeleria fiscal preparada",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            superStorage,
            "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/entityDocA-csf.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
          {
            customMetadata: {
              documentId: "entityDocA",
              entityType: "CLIENTE",
              entityId: "clientA",
              documentType: "CONSTANCIA_SITUACION_FISCAL",
            },
          },
        ),
      );
    },
  );

  await test(
    "Usuario ordinario no puede subir papeleria fiscal aun con documentId",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            sameRootStorage,
            "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/entityDocA-csf.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
          {
            customMetadata: {
              documentId: "entityDocA",
            },
          },
        ),
      );
    },
  );

  const failed = results.filter((item) => item.status === "FAIL");

  assert.equal(failed.length, 0);

  console.log("");
  console.log(
    `H4-D67-A6 RULES ENDURECIDAS: ${results.length}/${results.length} pruebas OK`,
  );
  console.log("");
  console.log(
    "Delegacion restaurada para Solicitudes y Pagos; Storage cerrado por entidad y upload preparado.",
  );
  console.log(
    "No se conecto a produccion y no se desplegaron reglas.",
  );
} finally {
  writeReport();
  await env.cleanup();
}