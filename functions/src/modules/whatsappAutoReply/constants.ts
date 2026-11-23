import { MAX_REPLY_AGE_MS } from "./domain";

export const REPLY_AGENT_ID = "hugo";
export const LOOKBACK_MS = MAX_REPLY_AGE_MS + 5 * 60 * 1000;
export const MAX_MESSAGES_PER_RUN = 400;
