export type ClientDelegationPermissionMap = {
  view: boolean;
  operate: boolean;
  viewBasic?: boolean;
  operateSolicitudes?: boolean;
  operatePagos?: boolean;
  operateBeneficiarios?: boolean;
  operateDispersiones?: boolean;
  viewBalanceInDispersion?: boolean;
  requestDispersionIncidents?: boolean;
  commentDispersionNotes?: boolean;
};

export type ClientDelegationMode = "PERMANENT" | "TEMPORARY";

export type ClientDelegationAccessSource = "OWN" | "HIERARCHY" | "DELEGATED" | "SUPERADMIN";

export type ClientDelegationConfigItem = {
  clientId: string;
  clientName: string;
  clientNumber: number;
  active: boolean;
  permissions: ClientDelegationPermissionMap;
  mode?: ClientDelegationMode;
  startsAt?: any | null;
  expiresAt?: any | null;
  revokedAt?: any | null;
  revokedBy?: string | null;
  grantReason?: string | null;
  adminId: string | null;
  ownerId: string | null;
  managedByUserId: string | null;
  createdBy: string | null;
};
