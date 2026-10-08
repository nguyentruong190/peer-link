/**
 * Pure, read-only Vietcombank transaction interpretation. No login, network or signing.
 *
 * Expects a structured JSON object representing one transaction detail screen
 * from the VCB Digibank mobile app. The caller is responsible for capturing
 * the transaction detail; the adapter only validates and interprets it.
 *
 * VND has no minor unit in common use; amounts are whole Vietnamese đồng
 * represented as non-negative integers.
 *
 * @param {unknown} input A VCB Digibank transaction detail object.
 * @param {string} transactionId Selected Vietcombank transaction reference (mã giao dịch).
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretVietcombank(input, transactionId) {
  const fail = (/** @type {string} */ reason) =>
    /** @type {const} */ ({ outcome: "insufficient_evidence", reason });
  const object = (/** @type {unknown} */ v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? /** @type {Record<string, unknown>} */ (v)
      : null;
  const nonempty = (/** @type {unknown} */ v) => typeof v === "string" && v.trim().length > 0;

  const root = object(input);
  if (!root) return fail("Expected a JSON object");

  if (!nonempty(transactionId)) return fail("A transaction ID is required");

  // --- Transaction reference ---
  const rawId = root.transactionId;
  if (typeof rawId !== "string" || !/^\d{9,15}$/.test(rawId.trim()))
    return fail("Transaction ID must be a 9–15 digit numeric string");
  const normalizedId = rawId.trim();
  if (normalizedId !== transactionId.trim())
    return fail("Transaction ID in the payload does not match the requested ID");

  // --- Direction: require observed outgoing direction ---
  const rawDirection = root.direction;
  if (typeof rawDirection !== "string" || !nonempty(rawDirection))
    return fail("Missing transaction direction");
  const dirLower = rawDirection.trim().toLowerCase();
  const OUTGOING_DIRECTIONS = new Set(["outgoing", "debit", "out", "chuyển đi", "đi"]);
  const INCOMING_DIRECTIONS = new Set(["incoming", "credit", "in", "nhận tiền", "đến"]);
  if (INCOMING_DIRECTIONS.has(dirLower))
    return { outcome: "unsupported", reason: "Incoming transfers are not supported" };
  if (!OUTGOING_DIRECTIONS.has(dirLower))
    return fail(
      `Invalid or unsupported transaction direction (got: ${rawDirection.trim().slice(0, 40)})`,
    );

  // --- Status: exact allowlist of observed completed statuses ---
  const rawStatus = root.status;
  if (typeof rawStatus !== "string" || !nonempty(rawStatus))
    return fail("Missing transaction status");
  const trimmedStatus = rawStatus.trim();
  const statusLower = trimmedStatus.toLowerCase();
  const FINAL_SUCCESS_STATUSES = new Set([
    "success",
    "successful",
    "completed",
    "thành công",
    "giao dịch thành công",
    "giao dịch thành công!",
  ]);
  if (!FINAL_SUCCESS_STATUSES.has(statusLower))
    return fail(`Transaction is not bank-reported completed (got: ${trimmedStatus.slice(0, 40)})`);

  // --- Transfer type: only intra-bank is supported ---
  const rawType = root.transferType;
  if (typeof rawType !== "string" || !nonempty(rawType)) return fail("Missing transfer type");
  const typeLower = rawType.trim().toLowerCase();
  const INTRA_BANK_TYPES = new Set([
    "intra_bank",
    "intrabank",
    "chuyển tiền trong vietcombank",
    "chuyen tien trong vietcombank",
    "within vietcombank",
    "same_bank",
    "same bank",
  ]);
  if (!INTRA_BANK_TYPES.has(typeLower))
    return {
      outcome: "unsupported",
      reason: `Only outgoing intra-bank (Vietcombank-to-Vietcombank) transfers are supported (got: ${rawType.trim().slice(0, 40)})`,
    };

  // --- Amount ---
  const rawAmount = root.amount;
  if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount <= 0)
    return fail("Expected a finite positive VND amount");
  if (!Number.isInteger(rawAmount))
    return fail("VND amounts must be whole numbers (no minor unit)");
  if (rawAmount > Number.MAX_SAFE_INTEGER) return fail("Amount exceeds safe integer range");
  const amountMinor = BigInt(rawAmount);

  // --- Currency ---
  const rawCurrency = root.currency;
  if (
    rawCurrency !== undefined &&
    rawCurrency !== null &&
    (typeof rawCurrency !== "string" || rawCurrency.trim().toUpperCase() !== "VND")
  )
    return fail(
      `Conflicting currency: expected VND, got ${String(rawCurrency).trim().slice(0, 10)}`,
    );

  // --- Timestamp ---
  const rawTimestamp = root.timestamp;
  if (typeof rawTimestamp !== "string" || !nonempty(rawTimestamp))
    return fail("Missing or invalid timestamp");
  const isoTimestamp = parseVcbTimestamp(rawTimestamp);
  if (!isoTimestamp) return fail(`Cannot parse timestamp: ${rawTimestamp.trim().slice(0, 40)}`);

  // --- Recipient (payee) & same-bank evidence ---
  const recipient = object(root.recipient);
  if (!recipient) return fail("Missing recipient object");
  const payeeAccount = recipient.accountNumber;
  if (typeof payeeAccount !== "string" || !/^\d{6,20}$/.test(payeeAccount.trim()))
    return fail("Recipient account number must be 6–20 digits");
  const payeeName = recipient.name;
  if (typeof payeeName !== "string" || !nonempty(payeeName))
    return fail("Recipient name is missing or empty");
  const payeeBank = recipient.bank;
  if (typeof payeeBank !== "string" || !nonempty(payeeBank))
    return fail("Recipient bank name is missing");
  const payeeBankLower = payeeBank.trim().toLowerCase();
  const VCB_BANK_NAMES = new Set([
    "vietcombank",
    "vcb",
    "ngân hàng tmcp ngoại thương việt nam",
    "ngan hang tmcp ngoai thuong viet nam",
  ]);
  if (!VCB_BANK_NAMES.has(payeeBankLower))
    return {
      outcome: "unsupported",
      reason: `Interbank transfer to ${payeeBank.trim()} is not supported; only intra-bank Vietcombank transfers are supported`,
    };

  // --- Payer (sender) ---
  const payerAccount = root.senderAccount;
  if (typeof payerAccount !== "string" || !/^\d{6,20}$/.test(payerAccount.trim()))
    return fail("Sender account number must be 6–20 digits");
  const payerName = root.senderName;
  if (typeof payerName !== "string" || !nonempty(payerName))
    return fail("Sender name is missing or empty");

  // Canonical bank namespace: ensure exact matching stability across all VCB bank name aliases
  const CANONICAL_BANK_NAMESPACE = "Vietcombank";

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "vn/vietcombank",
      transactionId: normalizedId,
      payer: {
        id: payerAccount.trim(),
        scheme: "vn-vietcombank-account",
        provenance: "transaction.senderAccount",
      },
      payee: {
        id: `${CANONICAL_BANK_NAMESPACE}:${payeeAccount.trim()}`,
        scheme: "vn-bank-account",
        provenance: "transaction.recipient",
      },
      amountMinor: amountMinor.toString(),
      currency: "VND",
      currencyExponent: 0,
      direction: "outgoing",
      status: trimmedStatus,
      timestamp: isoTimestamp,
      timestampMeaning: "transactionTime",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the sender-bank status, not proof of recipient credit or irreversible settlement.",
        "Payer identity is a Vietcombank account reference, not a verified legal person.",
        "Transaction ID is local to Vietcombank; no cross-bank deduplication is claimed.",
        "VND amount precision is whole đồng; no minor unit exists in common use.",
        "Transfer type is self-reported by the sender app; the parser cannot verify intra-bank routing independently.",
      ],
    },
  };
}

/**
 * Validate calendar components with a round-trip to reject impossible dates (e.g. Feb 31, Apr 31).
 *
 * @param {number} yyyy
 * @param {number} mo 1-12
 * @param {number} dd 1-31
 * @param {number} hh 0-23
 * @param {number} mm 0-59
 * @param {number} ss 0-59
 * @returns {boolean}
 */
function isValidCalendarComponents(yyyy, mo, dd, hh, mm, ss = 0) {
  if (
    mo < 1 ||
    mo > 12 ||
    dd < 1 ||
    dd > 31 ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59 ||
    ss < 0 ||
    ss > 59
  ) {
    return false;
  }
  const check = new Date(Date.UTC(yyyy, mo - 1, dd, hh, mm, ss));
  return (
    check.getUTCFullYear() === yyyy &&
    check.getUTCMonth() === mo - 1 &&
    check.getUTCDate() === dd &&
    check.getUTCHours() === hh &&
    check.getUTCMinutes() === mm &&
    check.getUTCSeconds() === ss
  );
}

/**
 * Parse a VCB Digibank timestamp string into an ISO-8601 UTC string.
 *
 * Accepted formats:
 *   - "DD/MM/YYYY HH:MM" or "HH:MM DayName DD/MM/YYYY" (Vietnamese locale, ICT = UTC+7)
 *   - "YYYY-MM-DDTHH:MM:SS[.mmm]Z" (ISO-8601)
 *   - "YYYY-MM-DD HH:MM:SS" (assumed ICT)
 *
 * @param {string} raw
 * @returns {string|null} ISO-8601 UTC timestamp or null if unparseable.
 */
function parseVcbTimestamp(raw) {
  const trimmed = raw.trim();

  // ISO-8601 with Z or offset
  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/,
  );
  if (isoMatch) {
    const [, yyyy, mo, dd, hh, mm, ss] = isoMatch;
    if (!isValidCalendarComponents(+yyyy, +mo, +dd, +hh, +mm, +ss)) return null;
    const date = new Date(trimmed);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  // Vietnamese format: "HH:MM DayName DD/MM/YYYY" (assumed ICT = UTC+7)
  const vnParts = trimmed.split(/\s+/);
  if (vnParts.length >= 3) {
    const timeMatch = vnParts[0].match(/^(\d{1,2}):(\d{2})$/);
    const dateMatch = vnParts[vnParts.length - 1].match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (timeMatch && dateMatch) {
      const [, hh, mm] = timeMatch;
      const [, dd, mo, yyyy] = dateMatch;
      if (!isValidCalendarComponents(+yyyy, +mo, +dd, +hh, +mm, 0)) return null;
      const date = new Date(Date.UTC(+yyyy, +mo - 1, +dd, +hh - 7, +mm, 0));
      if (!Number.isFinite(date.getTime())) return null;
      return date.toISOString();
    }
  }

  // Generic "YYYY-MM-DD HH:MM:SS" (assumed ICT = UTC+7)
  const genericMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (genericMatch) {
    const [, yyyy, mo, dd, hh, mm, ss] = genericMatch;
    if (!isValidCalendarComponents(+yyyy, +mo, +dd, +hh, +mm, +ss)) return null;
    const date = new Date(Date.UTC(+yyyy, +mo - 1, +dd, +hh - 7, +mm, +ss));
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  return null;
}
