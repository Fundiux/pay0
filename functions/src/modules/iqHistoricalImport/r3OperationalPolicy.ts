import { canonicalJson, deterministicId } from "./domain";

export const R3_OPERATIONAL_POLICY = Object.freeze({
  schemaVersion: 2,
  policyVersion: "P4-R3-IDENTITY-2026-10-08",
  rootId: "Ab4z0RttIqXbZFT0NuWsDjBkt6J2",
  mappings: Object.freeze({
    RR: Object.freeze({associatedName:"RR",canonicalIqGroupId:"iq-group-rr",canonicalIqProfileId:"Q3TaFdNTdR2mLPh7KcTi",adminId:"lcOz4nO5DTbksM3Lbz3hJcCpCdu1",pay0UserLabel:"BETELL"}),
    ELIUT: Object.freeze({associatedName:"ELIUT",canonicalIqGroupId:"iq-group-pay0",canonicalIqProfileId:"bEGPMuplqNHMZ3lvYkeb",adminId:"Ab4z0RttIqXbZFT0NuWsDjBkt6J2",pay0UserLabel:"EBASOR"}),
  }),
});

export const R3_OPERATIONAL_POLICY_HASH=deterministicId(canonicalJson(R3_OPERATIONAL_POLICY));
export const R3_OPERATIONAL_POLICY_BACKUP_ID=deterministicId("P4-R3-POLICY",R3_OPERATIONAL_POLICY.rootId,R3_OPERATIONAL_POLICY.policyVersion,R3_OPERATIONAL_POLICY_HASH);
