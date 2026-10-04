import { describe, expect, it } from "vitest";
import validFixtureData from "./fixtures/valid-intrabank-transfer.synthetic.json";
import { interpretVietcombank } from "./transformer.js";

const validFixture = validFixtureData.input;
const TX_ID = validFixtureData.transactionId;

describe("interpretVietcombank", () => {
  it("accepts a valid intra-bank transfer", () => {
    const result = interpretVietcombank(validFixture, TX_ID);
    expect(result.outcome === "supported").toBe(true);
    if (result.outcome !== "supported") throw new Error(`Got: ${JSON.stringify(result)}`);
    expect(result.payment.currency).toBe("VND");
    expect(result.payment.currencyExponent).toBe(0);
    expect(result.payment.amountMinor).toBe("2500000");
    expect(result.payment.direction).toBe("outgoing");
    expect(result.payment.status).toBe("success");
    expect(result.payment.transactionId).toBe(TX_ID);
    expect(result.payment.timestamp).toBe("2026-09-14T00:49:00.000Z");
    expect(result.payment.payer.id).toBe("000000000001");
    expect(result.payment.payee.id).toBe("Vietcombank:000000000002");
    expect(result.payment.sourceAuthenticated).toBe(false);
  });

  it("preserves exact observed status for allowed completed values", () => {
    const allowed = [
      "success",
      "SUCCESS",
      "thành công",
      "Thành công",
      "giao dịch thành công",
      "Giao dịch thành công!",
      "completed",
      "successful",
    ];
    for (const st of allowed) {
      const res = interpretVietcombank({ ...validFixture, status: st }, TX_ID);
      expect(res.outcome).toBe("supported");
      if (res.outcome === "supported") {
        expect(res.payment.status).toBe(st);
      }
    }
  });

  it("rejects negated, failed, pending, and unknown statuses", () => {
    const rejectedStatuses = [
      "unsuccessful",
      "not completed",
      "không thành công",
      "khong thanh cong",
      "giao dịch không thành công",
      "pending",
      "failed",
      "failure",
      "đang xử lý",
      "thất bại",
      "unknown",
      "",
    ];
    for (const st of rejectedStatuses) {
      const res = interpretVietcombank({ ...validFixture, status: st }, TX_ID);
      expect(res.outcome, `Status "${st}" should be rejected`).toBe("insufficient_evidence");
    }
    expect(interpretVietcombank({ ...validFixture, status: undefined }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("requires observed direction and rejects incoming transfers", () => {
    expect(interpretVietcombank({ ...validFixture, direction: "incoming" }, TX_ID)).toEqual({
      outcome: "unsupported",
      reason: "Incoming transfers are not supported",
    });
    expect(interpretVietcombank({ ...validFixture, direction: "credit" }, TX_ID)).toEqual({
      outcome: "unsupported",
      reason: "Incoming transfers are not supported",
    });
    expect(interpretVietcombank({ ...validFixture, direction: undefined }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, direction: "" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, direction: "invalid" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("accepts valid outgoing direction aliases", () => {
    for (const dir of ["outgoing", "debit", "out", "chuyển đi", "đi"]) {
      const res = interpretVietcombank({ ...validFixture, direction: dir }, TX_ID);
      expect(res.outcome).toBe("supported");
    }
  });

  it("requires same-bank evidence and rejects interbank transfers", () => {
    const interbankInput = {
      ...validFixture,
      recipient: { ...validFixture.recipient, bank: "Techcombank" },
    };
    const res = interpretVietcombank(interbankInput, TX_ID);
    if (res.outcome !== "supported") {
      expect(res.reason).toContain("only intra-bank Vietcombank transfers are supported");
    }

    const bidvInput = {
      ...validFixture,
      recipient: { ...validFixture.recipient, bank: "BIDV" },
    };
    expect(interpretVietcombank(bidvInput, TX_ID).outcome).toBe("unsupported");

    const mbInput = {
      ...validFixture,
      recipient: { ...validFixture.recipient, bank: "MB" },
    };
    expect(interpretVietcombank(mbInput, TX_ID).outcome).toBe("unsupported");
  });

  it("accepts known Vietcombank bank name aliases", () => {
    for (const bankName of ["Vietcombank", "VCB", "Ngân hàng TMCP Ngoại Thương Việt Nam"]) {
      const res = interpretVietcombank(
        { ...validFixture, recipient: { ...validFixture.recipient, bank: bankName } },
        TX_ID,
      );
      expect(res.outcome).toBe("supported");
    }
  });

  it("rejects unsupported or missing transfer types", () => {
    expect(
      interpretVietcombank({ ...validFixture, transferType: "napas_247" }, TX_ID).outcome,
    ).toBe("unsupported");
    expect(
      interpretVietcombank({ ...validFixture, transferType: "Chuyển tiền nhanh 24/7" }, TX_ID)
        .outcome,
    ).toBe("unsupported");
    expect(interpretVietcombank({ ...validFixture, transferType: undefined }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, transferType: "" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects a missing or mismatched transaction ID", () => {
    expect(interpretVietcombank(validFixture, "").outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank(validFixture, "99999999999").outcome).toBe("insufficient_evidence");
    expect(
      interpretVietcombank({ ...validFixture, transactionId: "not-numeric" }, TX_ID).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretVietcombank({ ...validFixture, transactionId: undefined }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects non-object input", () => {
    expect(interpretVietcombank(null, TX_ID).outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank("not-an-object", TX_ID).outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank([], TX_ID).outcome).toBe("insufficient_evidence");
  });

  it("validates amount constraints", () => {
    expect(interpretVietcombank({ ...validFixture, amount: 0 }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, amount: -100 }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, amount: 1000.5 }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, amount: "1000" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretVietcombank({ ...validFixture, amount: Number.MAX_SAFE_INTEGER + 1 }, TX_ID).outcome,
    ).toBe("insufficient_evidence");
  });

  it("validates currency", () => {
    expect(interpretVietcombank({ ...validFixture, currency: "USD" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, currency: 123 }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, currency: undefined }, TX_ID).outcome).toBe(
      "supported",
    );
  });

  it("handles various valid timestamp formats and rejects invalid ones", () => {
    // ISO-8601 UTC
    const resIso = interpretVietcombank(
      { ...validFixture, timestamp: "2026-09-14T00:49:00.000Z" },
      TX_ID,
    );
    expect(resIso.outcome).toBe("supported");

    // Vietnamese format: HH:MM Day DD/MM/YYYY (ICT = UTC+7)
    // 07:49 Thứ hai 14/09/2026 -> UTC 00:49:00
    const resVn = interpretVietcombank(
      { ...validFixture, timestamp: "07:49 ThứHai 14/09/2026" },
      TX_ID,
    );
    expect(resVn.outcome).toBe("supported");
    if (resVn.outcome === "supported") {
      expect(resVn.payment.timestamp).toBe("2026-09-14T00:49:00.000Z");
    }

    // Generic: YYYY-MM-DD HH:MM:SS (assumed ICT = UTC+7)
    const resGeneric = interpretVietcombank(
      { ...validFixture, timestamp: "2026-09-14 07:49:00" },
      TX_ID,
    );
    expect(resGeneric.outcome).toBe("supported");
    if (resGeneric.outcome === "supported") {
      expect(resGeneric.payment.timestamp).toBe("2026-09-14T00:49:00.000Z");
    }

    // Invalid timestamps
    expect(interpretVietcombank({ ...validFixture, timestamp: "not-a-date" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank({ ...validFixture, timestamp: undefined }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretVietcombank({ ...validFixture, timestamp: "99:99 Unknown 99/99/9999" }, TX_ID)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretVietcombank({ ...validFixture, timestamp: "2026-02-31 99:99:99" }, TX_ID).outcome,
    ).toBe("insufficient_evidence");
  });

  it("rejects missing or invalid party information", () => {
    // Missing recipient object
    expect(interpretVietcombank({ ...validFixture, recipient: null }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    // Invalid recipient account length
    expect(
      interpretVietcombank(
        { ...validFixture, recipient: { ...validFixture.recipient, accountNumber: "123" } },
        TX_ID,
      ).outcome,
    ).toBe("insufficient_evidence");
    // Missing recipient name
    expect(
      interpretVietcombank(
        { ...validFixture, recipient: { ...validFixture.recipient, name: "" } },
        TX_ID,
      ).outcome,
    ).toBe("insufficient_evidence");
    // Missing recipient bank
    expect(
      interpretVietcombank(
        { ...validFixture, recipient: { ...validFixture.recipient, bank: "" } },
        TX_ID,
      ).outcome,
    ).toBe("insufficient_evidence");
    // Missing sender account
    expect(interpretVietcombank({ ...validFixture, senderAccount: "123" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
    // Missing sender name
    expect(interpretVietcombank({ ...validFixture, senderName: "" }, TX_ID).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("deterministic: same input produces exact same output", () => {
    const r1 = interpretVietcombank(validFixture, TX_ID);
    const r2 = interpretVietcombank(validFixture, TX_ID);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
