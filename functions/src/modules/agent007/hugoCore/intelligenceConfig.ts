import { CONTEXT_BUILDER_VERSION } from "./contextBuilderV2";
import { CONVERSATION_STATE_VERSION } from "./conversationState";
import { MEMORY_CONTRACT_VERSION, MEMORY_RETRIEVAL_VERSION } from "./memoryContract";
import { HUGO_V2_PROMPT_VERSION } from "./hugoV2Prompt";

export const HUGO_V2_CONFIG = Object.freeze({ model: "gemini-2.5-flash", promptVersion: HUGO_V2_PROMPT_VERSION, contextBuilderVersion: CONTEXT_BUILDER_VERSION,
  conversationStateVersion: CONVERSATION_STATE_VERSION, memoryContractVersion: MEMORY_CONTRACT_VERSION, memoryRetrievalVersion: MEMORY_RETRIEVAL_VERSION,
  toolContractVersion: "phase2-v1", modelAdapterVersion: "vertex-gemini-v1" });
