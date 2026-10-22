import { createHash } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;
const INVALID_MESSAGE = "VOICE_TOPIC_RECEIPT_INVALID";


function invalid() {
  throw new Error(INVALID_MESSAGE);
}


function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}


function requireExactKeys(value, keys) {
  if (!isRecord(value)) {
    invalid();
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid();
  }
}


function requireNonemptyString(value) {
  if (typeof value !== "string" || value.trim() === "") {
    invalid();
  }
}


function requireId(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    invalid();
  }
}


function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid();
  }
}


function normalizeLabel(value) {
  requireNonemptyString(value);
  const label = value.trim().replace(/\s+/g, " ").normalize("NFC");
  if (label === "") {
    invalid();
  }
  return label;
}


function topicIdForLabel(label) {
  return createHash("sha256")
    .update(JSON.stringify(label.toLocaleLowerCase("es-MX")), "utf8")
    .digest("hex");
}


function requireCanonicalTopic(topic, label) {
  requireExactKeys(topic, ["kind", "id", "label"]);
  const expectedId = topicIdForLabel(label);
  if (
    topic.kind !== "TOPIC" ||
    topic.id !== expectedId ||
    topic.label !== label
  ) {
    invalid();
  }
  return Object.freeze({
    kind: "TOPIC",
    id: expectedId,
    label,
  });
}


function validateChallengeOrigin(origin) {
  requireExactKeys(origin, ["label", "correction", "expectedVersion"]);
  const label = normalizeLabel(origin.label);
  requireNonemptyString(origin.correction);
  requireExpectedVersion(origin.expectedVersion);
  return label;
}


function validateDurableOrigin(origin) {
  requireExactKeys(
    origin,
    ["challengeId", "label", "correction", "expectedVersion"],
  );
  requireId(origin.challengeId);
  const label = normalizeLabel(origin.label);
  requireNonemptyString(origin.correction);
  requireExpectedVersion(origin.expectedVersion);
  const version = origin.expectedVersion + 1;
  if (!Number.isSafeInteger(version)) {
    invalid();
  }
  return { label, version };
}


export function validateVoiceTopicChallenge(origin, result) {
  const label = validateChallengeOrigin(origin);
  requireExactKeys(
    result,
    ["state", "durablePersisted", "challengeId", "confirmationText"],
  );
  requireId(result.challengeId);

  const confirmationText =
    "Confirmo recordar esta indicación para el tema: " + label;
  if (
    result.state !== "PENDING" ||
    result.durablePersisted !== false ||
    result.confirmationText !== confirmationText
  ) {
    invalid();
  }

  return Object.freeze({
    challengeId: result.challengeId,
    confirmationText,
    label,
  });
}


export function validateVoiceTopicDurable(origin, result) {
  const { label, version } = validateDurableOrigin(origin);
  requireExactKeys(
    result,
    [
      "state",
      "challengeId",
      "durablePersisted",
      "transcriptAuthority",
      "correction",
      "topic",
      "created",
    ],
  );
  if (
    result.state !== "DURABLE" ||
    result.challengeId !== origin.challengeId ||
    result.durablePersisted !== true ||
    result.transcriptAuthority !== "CLIENT_TRANSCRIPT_NOT_FACT" ||
    typeof result.created !== "boolean"
  ) {
    invalid();
  }

  requireExactKeys(
    result.correction,
    [
      "memoryId",
      "version",
      "content",
      "status",
      "scope",
      "expiresAt",
      "topic",
    ],
  );
  requireId(result.correction.memoryId);
  if (
    result.correction.version !== version ||
    result.correction.content !== origin.correction ||
    result.correction.status !== "CONFIRMED" ||
    result.correction.scope !== "USER_TOPIC" ||
    result.correction.expiresAt !== null
  ) {
    invalid();
  }

  const correctionTopic = requireCanonicalTopic(
    result.correction.topic,
    label,
  );
  const resultTopic = requireCanonicalTopic(result.topic, label);
  if (
    resultTopic.kind !== correctionTopic.kind ||
    resultTopic.id !== correctionTopic.id ||
    resultTopic.label !== correctionTopic.label
  ) {
    invalid();
  }

  return Object.freeze({
    memoryId: result.correction.memoryId,
    version,
    topic: Object.freeze({ ...resultTopic }),
    confirmation:
      "Guardé tu indicación privada para ese tema, sin cambiar hechos, reglas ni permisos.",
  });
}


export function validateVoiceTopicSelection(origin, result) {
  if (!isRecord(origin) || typeof origin.clear !== "boolean") {
    invalid();
  }

  if (origin.clear) {
    const keys = Object.keys(origin);
    const hasLabel = Object.prototype.hasOwnProperty.call(origin, "label");
    if (
      !(
        (keys.length === 1 && keys[0] === "clear") ||
        (
          keys.length === 2 &&
          hasLabel &&
          keys.includes("clear") &&
          typeof origin.label === "string"
        )
      )
    ) {
      invalid();
    }

    requireExactKeys(result, ["scope", "selected", "topic"]);
    if (
      result.scope !== "PRIVATE_USER_STATEMENT" ||
      result.selected !== false ||
      result.topic !== null
    ) {
      invalid();
    }

    return Object.freeze({
      selected: false,
      topic: null,
    });
  }

  requireExactKeys(origin, ["label", "clear"]);
  const label = normalizeLabel(origin.label);
  requireExactKeys(result, ["scope", "selected", "topic"]);
  if (
    result.scope !== "PRIVATE_USER_STATEMENT" ||
    result.selected !== true
  ) {
    invalid();
  }

  const topic = requireCanonicalTopic(result.topic, label);
  return Object.freeze({
    selected: true,
    topic: Object.freeze({ ...topic }),
  });
}
