import {
  getApps,
  initializeApp,
} from "firebase-admin/app";
import {
  getFirestore,
} from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import {
  readBalanceAccountTx,
} from "../balances/repository";
import {
  requireClientOperationalAccess,
} from "../clientDelegations/access";
import {
  assertAuthorized,
} from "../../utils/authGuard";
import {
  resolveCanonicalDispersionPricing,
  resolveDispersionOperationTypeKey,
} from "./dispersionFinancial";

import { readForwardOnlyDerivedBalanceTx } from "../dispatchBalances/forwardOnly";
if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

export const previewClientDispersionPricing =
  onCall(
    {
      cors: true,
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    async (request) => {
      const uid = String(
        request.auth?.uid || "",
      ).trim();

      if (!uid) {
        throw new HttpsError(
          "unauthenticated",
          "Usuario no autenticado.",
        );
      }

      const data = request.data || {};
      const clientId = String(
        data.clienteId ||
          data.clientId ||
          "",
      ).trim();
      const methodId = String(
        data.methodId || "",
      ).trim();
      const despachoId = String(
        data.despachoId || "",
      ).trim();
      const amount = Number(
        data.amount || 0,
      );

      if (
        !clientId ||
        !methodId ||
        !despachoId
      ) {
        throw new HttpsError(
          "invalid-argument",
          "clienteId, methodId y despachoId son requeridos.",
        );
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Monto invalido.",
        );
      }

      const userSnap =
        await db.doc(
          `users/${uid}`,
        ).get();

      if (!userSnap.exists) {
        throw new HttpsError(
          "permission-denied",
          "Perfil de usuario no encontrado.",
        );
      }

      const profile =
        userSnap.data() || {};

      assertAuthorized(
        request.auth,
        profile,
        {
          allowedRoles: [
            "superadmin",
            "admin",
            "operador",
          ],
          requiredModule: "wallet",
          requiredAction:
            "dispersiones",
        },
      );

      const role = String(
        profile.role || "",
      )
        .trim()
        .toLowerCase();
      const rootId = String(
        profile.rootId || uid,
      ).trim();

      const access =
        await requireClientOperationalAccess({
          uid,
          role:
            role === "operator"
              ? "operador"
              : role as any,
          rootId,
          clientId,
          permission:
            "operateDispersiones",
          errorMessage:
            "No autorizado para cotizar dispersiones de este cliente.",
        });

      const methodSnap =
        await db.doc(
          `clientBeneficiaryMethods/${methodId}`,
        ).get();

      if (!methodSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Metodo no encontrado.",
        );
      }

      const method =
        methodSnap.data() || {};

      if (
        String(
          method.clientId ||
            method.clienteId ||
            "",
        ).trim() !== clientId ||
        method.active === false
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Metodo invalido para el cliente.",
        );
      }

      const operationTypeKey =
        resolveDispersionOperationTypeKey(
          method.tipo ||
            method.methodTipo,
          method.destinationKind,
        );

      const pricing =
        await resolveCanonicalDispersionPricing({
          db,
          rootId,
          clientId,
          client: access.client || {},
          adminId:
            access.economicOwnerAdminId,
          operadorId:
            access.economicOwnerOperadorId,
          despachoId,
          operationTypeKey,
          amount,
          currency: "MXN",
        });

      const beforeBalance =
        await db.runTransaction(
          async (tx) =>
            readForwardOnlyDerivedBalanceTx({
              tx,
              db,
              rootId,
              holderType: "CLIENT",
              holderId: clientId,
              despachoId,
              currency: pricing.currency,
            }),
        );

      return {
        ok: true,
        operationTypeKey:
          pricing.operationTypeKey,
        operationTypeName:
          pricing.operationTypeName,
        despachoId:
          pricing.despachoId,
        amount: pricing.amount,
        clientRate:
          pricing.clientCost.value,
        pricingMode:
          pricing.clientPricingMode,
        calculationBaseType:
          pricing.clientCalculationBaseType,
        clientChargeAmount:
          pricing.clientChargeAmount,
        totalClientDebitAmount:
          pricing.totalClientDebitAmount,
        despachoCostAmount:
          pricing.despachoCostAmount,
        superadminEarningAmount:
          pricing.superadminEarningAmount,
        adminEarningAmount:
          pricing.adminEarningAmount,
        operadorEarningAmount:
          pricing.operadorEarningAmount,
        totalEarningsAmount:
          pricing.totalEarningsAmount,
        beforeBalance,
        afterBalance:
          beforeBalance -
          pricing.totalClientDebitAmount,
        canCreate:
          beforeBalance >=
          pricing.totalClientDebitAmount,
        currency:
          pricing.currency,
      };
    },
  );
