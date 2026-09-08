"use client";

import EntityDocumentsPanel from "./EntityDocumentsPanel";

type Props = {
  clientId: string;
  canManage: boolean;
};

export default function ClientEntityDocumentsPanel({ clientId, canManage }: Props) {
  return (
    <EntityDocumentsPanel
      entityType="CLIENTE"
      entityId={clientId}
      canManage={canManage}
      scopeLabel="cliente"
    />
  );
}