import { onCall } from "firebase-functions/v2/https";
import {
  deactivateEntityDocumentCore,
  reactivateEntityDocumentCore,
  finalizeEntityDocumentUploadCore,
  initEntityDocumentUploadCore,
  listEntityDocumentsCore,
} from "./service";

export const initEntityDocumentUpload = onCall(async (request) => {
  return await initEntityDocumentUploadCore(request);
});

export const finalizeEntityDocumentUpload = onCall(async (request) => {
  return await finalizeEntityDocumentUploadCore(request);
});

export const listEntityDocuments = onCall(async (request) => {
  return await listEntityDocumentsCore(request);
});

export const deactivateEntityDocument = onCall(async (request) => {
  return await deactivateEntityDocumentCore(request);
});
export const reactivateEntityDocument = onCall(async (request) => {
  return await reactivateEntityDocumentCore(request);
});