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
  "pay0-system-rules-baseline";

const reportPath =
  process.env.PAY0_RULES_REPORT_PATH ||
  path.join(root, "audit", "H4-D67-A5-rules-report.json");

const firestoreRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8",
);

const storageRules = fs.readFileSync(
  path.join(root, "storage.rules"),
  "utf8",
);

const results = [];
const confirmedFindings = [];

function record(name, status, classification, detail = "") {
  results.push({
    name,
    status,
    classification,
    detail,
  });
}

async function test(name, classification, action) {
  try {
    await action();
    record(name, "PASS", classification);
    console.log(`PASS ${name}`);

    if (classification === "HALLAZGO_ACTUAL") {
      confirmedFindings.push(name);
    }
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    record(name, "FAIL", classification, detail);
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
        block: "H4-D67-A5",
        generatedAt: new Date().toISOString(),
        projectId,
        total: results.length,
        passed: results.filter((item) => item.status === "PASS").length,
        failed: results.filter((item) => item.status === "FAIL").length,
        confirmedFindings,
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

    await setDoc(doc(db, "pagos", "pagoA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
      companyId: "companyA",
      monto: 100,
    });

    await setDoc(doc(db, "clientDispersions", "dispA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
      monto: 10,
    });

    const storage = context.storage();

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/solicitudes/solA/documentos/privado.txt",
      ),
      new Uint8Array([80, 65, 89, 48]),
    );
  });

  const unauthenticatedDb = env.unauthenticatedContext().firestore();
  const superDb = env.authenticatedContext("superA").firestore();
  const adminDb = env.authenticatedContext("adminA").firestore();
  const delegatedDb = env.authenticatedContext("delegatedA").firestore();

  await test(
    "Firestore bloquea lectura anonima de Solicitudes",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        getDoc(doc(unauthenticatedDb, "solicitudes", "solA")),
      );
    },
  );

  await test(
    "Firestore permite al superadmin leer Solicitudes",
    "CONTROL_FUNCIONAL",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(superDb, "solicitudes", "solA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Firestore permite al creador leer su Solicitud",
    "CONTROL_FUNCIONAL",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(adminDb, "solicitudes", "solA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Delegacion activa NO permite leer Solicitudes con las reglas actuales",
    "HALLAZGO_ACTUAL",
    async () => {
      await assertFails(
        getDoc(doc(delegatedDb, "solicitudes", "solA")),
      );
    },
  );

  await test(
    "Delegacion activa NO permite leer Pagos con las reglas actuales",
    "HALLAZGO_ACTUAL",
    async () => {
      await assertFails(
        getDoc(doc(delegatedDb, "pagos", "pagoA")),
      );
    },
  );

  await test(
    "Delegacion activa SI permite leer Dispersiones como control",
    "CONTROL_FUNCIONAL",
    async () => {
      const snapshot = await assertSucceeds(
        getDoc(doc(delegatedDb, "clientDispersions", "dispA")),
      );

      assert.equal(snapshot.exists(), true);
    },
  );

  await test(
    "Firestore bloquea escritura directa de Solicitudes incluso al superadmin",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        setDoc(doc(superDb, "solicitudes", "directWrite"), {
          rootId: "rootA",
          clientId: "clientA",
          adminId: "superA",
          createdBy: "superA",
          monto: 1,
        }),
      );
    },
  );

  const anonymousStorage = env.unauthenticatedContext().storage();
  const sameRootStorage =
    env.authenticatedContext("sameRootA").storage();
  const otherRootStorage =
    env.authenticatedContext("otherRootB").storage();

  const privateObject =
    "roots/rootA/solicitudes/solA/documentos/privado.txt";

  await test(
    "Storage bloquea lectura anonima",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        getBytes(ref(anonymousStorage, privateObject)),
      );
    },
  );

  await test(
    "Usuario ordinario del mismo root puede leer cualquier ruta general actual",
    "HALLAZGO_ACTUAL",
    async () => {
      const data = await assertSucceeds(
        getBytes(ref(sameRootStorage, privateObject)),
      );

      assert.ok(data.byteLength > 0);
    },
  );

  await test(
    "Usuario ordinario del mismo root puede escribir cualquier ruta general menor a 1 MB",
    "HALLAZGO_ACTUAL",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            sameRootStorage,
            "roots/rootA/otroModulo/otraEntidad/archivo.txt",
          ),
          new Uint8Array([1, 2, 3]),
        ),
      );
    },
  );

  await test(
    "Storage bloquea acceso cruzado entre roots",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        getBytes(ref(otherRootStorage, privateObject)),
      );
    },
  );

  await test(
    "Storage bloquea archivos generales mayores a 1 MB",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            sameRootStorage,
            "roots/rootA/otroModulo/grande.bin",
          ),
          new Uint8Array(1024 * 1024 + 1),
        ),
      );
    },
  );

  await test(
    "Usuario ordinario del mismo root puede subir KYC de cualquier entidad actual",
    "HALLAZGO_ACTUAL",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(
            sameRootStorage,
            "roots/rootA/entityDocuments/CLIENT/clientA/CSF/csf.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
        ),
      );
    },
  );

  await test(
    "Storage KYC bloquea escritura desde otro root",
    "CONTROL_SEGURO",
    async () => {
      await assertFails(
        uploadBytes(
          ref(
            otherRootStorage,
            "roots/rootA/entityDocuments/CLIENT/clientA/CSF/otro.pdf",
          ),
          new Uint8Array([37, 80, 68, 70]),
        ),
      );
    },
  );

  const failed = results.filter((item) => item.status === "FAIL");

  assert.equal(failed.length, 0);

  console.log("");
  console.log(
    `H4-D67-A5 BASELINE RULES: ${results.length}/${results.length} pruebas OK`,
  );
  console.log("");
  console.log("HALLAZGOS CONFIRMADOS, TODAVIA NO CORREGIDOS:");

  for (const name of confirmedFindings) {
    console.log(`- ${name}`);
  }

  console.log("");
  console.log(
    "No se conecto a produccion y no se modificaron firestore.rules ni storage.rules.",
  );
} finally {
  writeReport();
  await env.cleanup();
}