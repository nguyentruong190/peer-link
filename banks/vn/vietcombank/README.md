# Vietcombank (VN) — Peer Link Adapter

## Scope

- **Bank:** Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)
- **Surface:** `vcb-digibank-transaction-detail` — VCB Digibank transaction receipt and detail screen
- **Payment type:** Outgoing intra-bank VND transfer (Vietcombank → Vietcombank)
- **Currency:** VND (ISO 4217, exponent 0 — whole đồng, no minor unit in circulation)
- **Direction:** Outgoing only

## Observed Surface & Receipt Fields

In the VCB Digibank mobile app and web portal, completing a transfer or opening a transaction from history displays a structured receipt screen. The fields are mapped as follows:

| VCB Digibank Receipt Field | Adapter JSON Field | Example / Format | Source & Meaning |
|-----------------------------|--------------------|-------------------|------------------|
| Tiêu đề trạng thái | `status` | `"Giao dịch thành công!"` / `"success"` | **Observed:** Completed transfer header. Exact allowlist required. |
| Số tiền | `amount` | `2500000` (from `2,500,000 VND`) | **Observed:** Whole VND integer without minor units. |
| Đơn vị tiền tệ | `currency` | `"VND"` | **Observed / Inferred:** Checked for currency conflicts. |
| Ngày giờ | `timestamp` | `12:11 Thứ Ba 08/09/2026` or ISO-8601 | **Observed:** Vietnam Indochina Time (ICT, UTC+7), converted to UTC ISO-8601 `Z`. Calendar components are round-trip validated to reject impossible dates. |
| Mã giao dịch | `transactionId` | `15948699606` | **Observed:** 9–15 digit numeric bank transaction reference. |
| Chiều giao dịch | `direction` | `"outgoing"` / `"debit"` | **Inferred from session:** Sender-initiated outgoing debit. |
| Hình thức chuyển | `transferType` | `"Chuyển tiền trong Vietcombank"` / `"intra_bank"` | **Observed:** Transfer rail. Interbank rails (`Chuyển tiền nhanh 24/7`, `napas 24/7`) return `unsupported`. |
| Tài khoản trích nợ | `senderAccount` | `000000000001` (6–20 digits) | **Session context:** Debited account number from authenticated session / full statement. |
| Tên người chuyển | `senderName` | `NGUYEN VAN A` | **Session context:** Authenticated sender account name. |
| Tài khoản nhận | `recipient.accountNumber` | `000000000002` (6–20 digits) | **Observed:** Beneficiary account number. |
| Tên người nhận | `recipient.name` | `TRAN THI B` | **Observed:** Beneficiary name. |
| Ngân hàng nhận | `recipient.bank` | `"Vietcombank"` / `"VCB"` | **Observed:** Must be Vietcombank. Other banks (e.g. `VietinBank`, `LPBank`, `MB`) return `unsupported`. |

## Semantics

- **Payer (A):** `senderAccount` identifies the debited Vietcombank account. This is a bank account identifier scheme `vn-vietcombank-account`, not an attested legal identity.
- **Payee (B):** Emits a single canonical namespace `Vietcombank:<accountNumber>` under `vn-bank-account` (provenance `transaction.recipient`), regardless of whether the receipt shows `"Vietcombank"`, `"VCB"`, or the full legal bank name. This ensures exact matching in `matchPayment` is stable.
- **Amount & Currency:** Non-negative whole integer in VND (`currencyExponent: 0`). VND has no cents or minor fractional units in circulation. Conflicting currency fails.
- **Status:** Exact allowlist matching observed completed statuses: `"thành công"`, `"giao dịch thành công"`, `"giao dịch thành công!"`, `"success"`, `"successful"`, `"completed"`. Negated strings (`"unsuccessful"`, `"không thành công"`, `"not completed"`), pending, and failed statuses abstain with `insufficient_evidence`.
- **Direction & Rail:** Must explicitly be outgoing intra-bank (`Vietcombank -> Vietcombank`). Incoming transfers (`"incoming"`, `"credit"`) and interbank transfers (`"Chuyển tiền nhanh 24/7"`, NAPAS 24/7, or non-VCB recipient banks) return `unsupported`.
- **Timestamp:** VCB receipt timestamp format `HH:MM Thứ... DD/MM/YYYY` is interpreted in ICT (UTC+7) and normalized to UTC ISO-8601 ending in `Z`. Round-trip validation checks calendar components (`yyyy`, `mo`, `dd`, `hh`, `mm`, `ss`) so impossible dates (e.g. Feb 31, Apr 31) are rejected rather than rolled over.

## Local acquisition

1. Sign in to your authorized VCB Digibank mobile app or web session using normal authentication.
2. Complete or navigate to an existing completed outgoing intra-bank transfer detail screen.
3. Observe the displayed receipt fields (`Mã giao dịch`, `Số tiền`, `Tài khoản nhận`, `Ngân hàng nhận`, `Hình thức chuyển`, `Ngày giờ`).
4. Shape the captured fields into the adapter JSON object locally in `.local/` (which is git-ignored and never committed or shared).
5. Run the pure adapter against the captured data:

```sh
npm run try:bank -- vn/vietcombank .local/vcb-response.json <transactionId>
```

Compare the emitted facts with the bank screen. Never commit raw responses, screenshots, or personal data.

## Validation

Run repository and adapter tests:

```sh
npm test
npm run validate
npm run check:bank
```

Test coverage includes:
- Supported intra-bank transfer with exact status preservation, canonical `payee.id` namespace, and UTC timestamp normalization.
- Exact status allowlist verifying that negated, failed, pending, and unknown statuses abstain.
- Direction validation rejecting incoming transfers as `unsupported`.
- Same-bank evidence verifying that interbank recipient banks (e.g. VietinBank, LPBank, MB) and NAPAS transfer types return `unsupported`.
- Calendar round-trip validation rejecting impossible dates across ISO-8601 and local Vietnamese formats.
- Numeric amount validation enforcing positive integers without fractional units.
- Mismatched or malformed transaction IDs and missing recipient data.
- Deterministic execution without side-effects or network calls.

## Limitations

- Only outgoing intra-bank (Vietcombank → Vietcombank) transfers are supported.
- Interbank NAPAS 24/7, incoming transfers, card payments, and international wires are unsupported.
- The parser interprets structured evidence but cannot cryptographically authenticate the source of untrusted input.
- Transaction ID is local to Vietcombank; no cross-bank deduplication is claimed.
