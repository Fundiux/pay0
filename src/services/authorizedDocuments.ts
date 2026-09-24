import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function getAuthorizedDocumentDownloadUrl(uploadId: string): Promise<string> {
  const callable = httpsCallable<{ uploadId: string }, {
    ok: boolean;
    uploadId: string;
    url: string;
    expiresInSeconds: number;
  }>(functions, "getAuthorizedDocumentDownloadUrl");
  const result = await callable({ uploadId });
  return result.data.url;
}
