import { onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { createRestrictionService, RestrictionDatabase } from "./restrictionService";

// Only own read-only status is exported. Restriction writers remain unexported pending enforcement gates.
const service = createRestrictionService(db as unknown as RestrictionDatabase);
export const issueTrustedUserRestriction = onCall({ region: "us-central1" }, request => service.issue(request.auth, request.data));
export const revokeTrustedUserRestriction = onCall({ region: "us-central1" }, request => service.revoke(request.auth, request.data));
export const getMyRestrictionStatus = onCall({ region: "us-central1" }, request => service.getMyStatus(request.auth));
