import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const root = process.cwd();
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "pay0-system-rules-a9";

const reportPath =
  process.env.PAY0_RULES_REPORT_PATH ||
  path.join(root, "audit", "H4-D67-A9-rules-report.json");

const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8"),
  },
  storage: {
    rules: fs.readFileSync(path.join(root, "storage.rules"), "utf8"),
  },
});

const results = [];

async function test(name, action) {
  try {
    await action();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function report() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        block: "H4-D67-A9",
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

try {
  await env.clearFirestore();
  await env.clearStorage();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    const users = [
      ["rootA", { role: "superadmin", rootId: "rootA" }],
      ["adminA", { role: "admin", rootId: "rootA" }],
      ["solUser", { role: "operador", rootId: "rootA" }],
      ["payUser", { role: "operador", rootId: "rootA" }],
      ["dispUser", { role: "operador", rootId: "rootA" }],
      ["legacyUser", { role: "operador", rootId: "rootA" }],
      ["deniedUser", { role: "operador", rootId: "rootA" }],
      ["sameRoot", { role: "operador", rootId: "rootA" }],
    ];

    for (const [uid, data] of users) {
      await setDoc(doc(db, "users", uid), data);
    }

    const accesses = [
      [
        "solUser",
        {
          active: true,
          rootId: "rootA",
          permissions: {
            view: true,
            operate: false,
            viewBasic: true,
            operateSolicitudes: true,
            operatePagos: false,
            operateDispersiones: false,
          },
        },
      ],
      [
        "payUser",
        {
          active: true,
          rootId: "rootA",
          permissions: {
            view: true,
            operate: false,
            viewBasic: true,
            operateSolicitudes: false,
            operatePagos: true,
            operateDispersiones: false,
          },
        },
      ],
      [
        "dispUser",
        {
          active: true,
          rootId: "rootA",
          permissions: {
            view: true,
            operate: false,
            viewBasic: true,
            operateSolicitudes: false,
            operatePagos: false,
            operateDispersiones: true,
          },
        },
      ],
      [
        "legacyUser",
        {
          active: true,
          rootId: "rootA",
          permissions: {
            view: true,
            operate: true,
          },
        },
      ],
      [
        "deniedUser",
        {
          active: true,
          rootId: "rootA",
          permissions: {
            view: true,
            operate: false,
            viewBasic: true,
            operateSolicitudes: false,
            operatePagos: false,
            operateDispersiones: false,
          },
        },
      ],
    ];

    for (const [uid, data] of accesses) {
      await setDoc(
        doc(db, "userClientAccess", uid, "clients", "clientA"),
        data,
      );
    }

    await setDoc(doc(db, "solicitudes", "solA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
    });

    await setDoc(doc(db, "pagos", "pagoA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
    });

    await setDoc(doc(db, "clientDispersions", "dispA"), {
      rootId: "rootA",
      clientId: "clientA",
      clienteId: "clientA",
      adminId: "adminA",
      createdBy: "adminA",
    });

    const uploads = [
      [
        "upSol",
        {
          rootId: "rootA",
          entityType: "solicitudes",
          entityId: "solA",
          createdBy: "solUser",
          status: "PENDING",
          storagePath:
            "roots/rootA/solicitudes/solA/docs/OTRO/upSol-file.txt",
        },
      ],
      [
        "upPago",
        {
          rootId: "rootA",
          entityType: "pagos",
          entityId: "pagoA",
          createdBy: "payUser",
          status: "PENDING",
          storagePath:
            "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/upPago-file.pdf",
        },
      ],
      [
        "upDisp",
        {
          rootId: "rootA",
          entityType: "clientDispersions",
          entityId: "dispA",
          createdBy: "dispUser",
          status: "PENDING",
          storagePath:
            "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/upDisp-file.pdf",
        },
      ],
      [
        "upGeneric",
        {
          rootId: "rootA",
          entityType: "solicitudes",
          entityId: "solA",
          createdBy: "solUser",
          status: "pending",
          storagePath:
            "roots/rootA/solicitudes/solA/legacy-file.txt",
        },
      ],
    ];

    for (const [id, data] of uploads) {
      await setDoc(doc(db, "uploads", id), data);
    }

    await setDoc(doc(db, "entityDocuments", "entityDocA"), {
      rootId: "rootA",
      entityType: "CLIENTE",
      entityId: "clientA",
      documentType: "CONSTANCIA_SITUACION_FISCAL",
      createdBy: "rootA",
      uploadStatus: "PENDING_UPLOAD",
      storagePath:
        "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/entityDocA-csf.pdf",
    });

    const storage = context.storage();

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/solicitudes/solA/docs/OTRO/existing.txt",
      ),
      new Uint8Array([1]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/existing.pdf",
      ),
      new Uint8Array([1]),
    );

    await uploadBytes(
      ref(
        storage,
        "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/existing.pdf",
      ),
      new Uint8Array([1]),
    );
  });

  const solDb = env.authenticatedContext("solUser").firestore();
  const payDb = env.authenticatedContext("payUser").firestore();
  const legacyDb = env.authenticatedContext("legacyUser").firestore();
  const deniedDb = env.authenticatedContext("deniedUser").firestore();

  await test("Solicitud permite operateSolicitudes", async () => {
    const snap = await assertSucceeds(
      getDoc(doc(solDb, "solicitudes", "solA")),
    );
    assert.equal(snap.exists(), true);
  });

  await test("Solicitud bloquea usuario con solo operatePagos", async () => {
    await assertFails(getDoc(doc(payDb, "solicitudes", "solA")));
  });

  await test("Pago permite operatePagos", async () => {
    const snap = await assertSucceeds(
      getDoc(doc(payDb, "pagos", "pagoA")),
    );
    assert.equal(snap.exists(), true);
  });

  await test("Pago bloquea usuario con solo operateSolicitudes", async () => {
    await assertFails(getDoc(doc(solDb, "pagos", "pagoA")));
  });

  await test("Fallback legacy operate=true conserva acceso", async () => {
    const solicitud = await assertSucceeds(
      getDoc(doc(legacyDb, "solicitudes", "solA")),
    );
    const pago = await assertSucceeds(
      getDoc(doc(legacyDb, "pagos", "pagoA")),
    );
    assert.equal(solicitud.exists(), true);
    assert.equal(pago.exists(), true);
  });

  await test("Permisos especificos false bloquean aunque active=true", async () => {
    await assertFails(getDoc(doc(deniedDb, "solicitudes", "solA")));
    await assertFails(getDoc(doc(deniedDb, "pagos", "pagoA")));
  });

  const solStorage = env.authenticatedContext("solUser").storage();
  const payStorage = env.authenticatedContext("payUser").storage();
  const dispStorage = env.authenticatedContext("dispUser").storage();
  const deniedStorage = env.authenticatedContext("deniedUser").storage();
  const sameRootStorage = env.authenticatedContext("sameRoot").storage();
  const superStorage = env.authenticatedContext("rootA").storage();

  await test("Solicitud Storage permite modulo correcto", async () => {
    const data = await assertSucceeds(
      getBytes(
        ref(
          solStorage,
          "roots/rootA/solicitudes/solA/docs/OTRO/existing.txt",
        ),
      ),
    );
    assert.ok(data.byteLength > 0);
  });

  await test("Solicitud Storage bloquea modulo Pagos", async () => {
    await assertFails(
      getBytes(
        ref(
          payStorage,
          "roots/rootA/solicitudes/solA/docs/OTRO/existing.txt",
        ),
      ),
    );
  });

  await test("Pago Storage permite modulo correcto", async () => {
    const data = await assertSucceeds(
      getBytes(
        ref(
          payStorage,
          "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/existing.pdf",
        ),
      ),
    );
    assert.ok(data.byteLength > 0);
  });

  await test("Dispersion Storage permite modulo correcto", async () => {
    const data = await assertSucceeds(
      getBytes(
        ref(
          dispStorage,
          "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/existing.pdf",
        ),
      ),
    );
    assert.ok(data.byteLength > 0);
  });

  await test("Usuario sin modulo no puede leer Storage", async () => {
    await assertFails(
      getBytes(
        ref(
          deniedStorage,
          "roots/rootA/solicitudes/solA/docs/OTRO/existing.txt",
        ),
      ),
    );
  });

  await test("Mismo root sin asignacion no puede leer Storage", async () => {
    await assertFails(
      getBytes(
        ref(
          sameRootStorage,
          "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/existing.pdf",
        ),
      ),
    );
  });

  await test("Upload preparado de Solicitud funciona", async () => {
    await assertSucceeds(
      uploadBytes(
        ref(
          solStorage,
          "roots/rootA/solicitudes/solA/docs/OTRO/upSol-file.txt",
        ),
        new Uint8Array([1, 2]),
        {
          customMetadata: {
            uploadid: "upSol",
          },
        },
      ),
    );
  });

  await test("Upload preparado de Pago funciona", async () => {
    await assertSucceeds(
      uploadBytes(
        ref(
          payStorage,
          "roots/rootA/pagos/pagoA/docs/COMPROBANTE_PAGO/upPago-file.pdf",
        ),
        new Uint8Array([1, 2]),
        {
          customMetadata: {
            uploadid: "upPago",
          },
        },
      ),
    );
  });

  await test("Upload preparado de Dispersion funciona", async () => {
    await assertSucceeds(
      uploadBytes(
        ref(
          dispStorage,
          "roots/rootA/dispersiones/dispA/docs/COMPROBANTE_DISPERSION/upDisp-file.pdf",
        ),
        new Uint8Array([1, 2]),
        {
          customMetadata: {
            uploadid: "upDisp",
          },
        },
      ),
    );
  });

  await test("Ruta generica legacy queda cerrada", async () => {
    await assertFails(
      uploadBytes(
        ref(
          solStorage,
          "roots/rootA/solicitudes/solA/legacy-file.txt",
        ),
        new Uint8Array([1]),
        {
          customMetadata: {
            uploadId: "upGeneric",
          },
        },
      ),
    );
  });

  await test("KYC sigue reservado al superadmin", async () => {
    await assertSucceeds(
      uploadBytes(
        ref(
          superStorage,
          "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/entityDocA-csf.pdf",
        ),
        new Uint8Array([37, 80, 68, 70]),
        {
          customMetadata: {
            documentid: "entityDocA",
          },
        },
      ),
    );

    await assertFails(
      uploadBytes(
        ref(
          solStorage,
          "roots/rootA/entityDocuments/CLIENTE/clientA/CONSTANCIA_SITUACION_FISCAL/otro.pdf",
        ),
        new Uint8Array([37, 80, 68, 70]),
        {
          customMetadata: {
            documentid: "entityDocA",
          },
        },
      ),
    );
  });

  const failed = results.filter((item) => item.status === "FAIL");
  assert.equal(failed.length, 0);

  console.log("");
  console.log(
    `H4-D67-A9 RULES: ${results.length}/${results.length} pruebas OK`,
  );
  console.log(
    "Permisos granulares y uploads reales compatibles; ruta generica cerrada.",
  );
} finally {
  report();
  await env.cleanup();
}