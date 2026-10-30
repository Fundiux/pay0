import { onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { createRestrictionService, RestrictionDatabase } from "./restrictionService";

// Prepared only: NO index export/deploy until HTTP, workers, rules and recovery gates pass.
const service = createRestrictionService(db as unknown as RestrictionDatabase);
export const issueTrustedUserRestriction = onCall({ region: "us-central1" }, request => service.issue(request.auth, request.data));
export const revokeTrustedUserRestriction = onCall({ region: "us-central1" }, request => service.revoke(request.auth, request.data));
export const getMyRestrictionStatus = onCall({ region: "us-central1" }, request => service.getMyStatus(request.auth));
