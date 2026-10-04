# Vietcombank (VN) — Peer Link Adapter

## Scope

- **Bank:** Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)
- **Surface:** `vcb-digibank-transaction-detail` — VCB Digibank transaction receipt and detail screen
- **Payment type:** Outgoing intra-bank VND transfer (Vietcombank → Vietcombank)
- **Currency:** VND (ISO 4217, exponent 0 — whole đồng, no minor unit in circulation)
- **Direction:** Outgoing only

## Observed Surface & Receipt Fields

In the VCB Digibank mobile app and web portal, completing a transfer or opening a transaction from history displays a structured receipt screen with the following observed fields:

| VCB Digibank Receipt Field | Adapter JSON Field | Example / Format | Meaning |
|-----------------------------|--------------------|-------------------|---------|
| Tiêu đề trạng thái | `status` | `"Giao dịch thành công!"` / `"success"` | Completed transfer marker. Exact allowlist required. |
| Số tiền | `amount` | `2500000` (from `2,500,000 VND`) | Whole VND integer without minor units. |
| Đơn vị tiền tệ | `currency` | `"VND"` | Implicit or explicit ISO 4217 code. |
| Ngày giờ | `timestamp` | `12:11 Thứ Ba 08/09/2026` or ISO-8601 | Vietnam Indochina Time (ICT, UTC+7), converted to UTC ISO-8601 `Z`. |
| Mã giao dịch | `transactionId` | `15948699606` | 9–15 digit numeric bank transaction reference. |
| Chiều giao dịch | `direction` | `"outgoing"` / `"debit"` | Outgoing payment direction. |
| Hình thức chuyển | `transferType` | `"Chuyển tiền trong Vietcombank"` / `"intra_bank"` | Transfer rail. Interbank rails (`Chuyển tiền nhanh 24/7`, `napas 24/7`) return `unsupported`. |
| Tài khoản trích nợ | `senderAccount` | `000000000001` (6–20 digits) | Sender account reference from account session. |
| Tên người chuyển | `senderName` | `NGUYEN VAN A` | Sender account name. |
| Tài khoản nhận | `recipient.accountNumber` | `000000000002` (6–20 digits) | Beneficiary account number. |
| Tên người nhận | `recipient.name` | `TRAN THI B` | Beneficiary name. |
| Ngân hàng nhận | `recipient.bank` | `"Vietcombank"` / `"VCB"` | Must be Vietcombank. Other banks (e.g. `VietinBank`, `LPBank`, `MB`) return `unsupported`. |

## Semantics

- **Payer (A):** `senderAccount` identifies the debited Vietcombank account. This is a bank account identifier scheme `vn-vietcombank-account`, not an attested legal identity.
- **Payee (B):** `recipient.accountNumber` plus `recipient.bank` (provenance `transaction.recipient`), formatted as `vn-bank-account` (`Vietcombank:<accountNumber>`).
- **Amount & Currency:** Non-negative whole integer in VND (`currencyExponent: 0`). VND has no cents or minor fractional units in circulation. Conflicting currency fails.
- **Status:** Exact allowlist matching observed completed statuses: `"thành công"`, `"giao dịch thành công"`, `"giao dịch thành công!"`, `"success"`, `"successful"`, `"completed"`. Negated strings (`"unsuccessful"`, `"không thành công"`, `"not completed"`), pending, and failed statuses abstain with `insufficient_evidence`.
- **Direction & Rail:** Must explicitly be outgoing intra-bank (`Vietcombank -> Vietcombank`). Incoming transfers (`"incoming"`, `"credit"`) and interbank transfers (`"Chuyển tiền nhanh 24/7"`, NAPAS 24/7, or non-VCB recipient banks) return `unsupported`.
- **Timestamp:** VCB receipt timestamp format `HH:MM Thứ... DD/MM/YYYY` is interpreted in ICT (UTC+7) and normalized to UTC ISO-8601 ending in `Z`.

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
- Supported intra-bank transfer with exact status preservation and UTC timestamp normalization.
- Exact status allowlist verifying that negated, failed, pending, and unknown statuses abstain.
- Direction validation rejecting incoming transfers as `unsupported`.
- Same-bank evidence verifying that interbank recipient banks (e.g. VietinBank, LPBank, MB) and NAPAS transfer types return `unsupported`.
- Numeric amount validation enforcing positive integers without fractional units.
- Mismatched or malformed transaction IDs and missing recipient data.
- Deterministic execution without side-effects or network calls.

## Limitations

- Only outgoing intra-bank (Vietcombank → Vietcombank) transfers are supported.
- Interbank NAPAS 24/7, incoming transfers, card payments, and international wires are unsupported.
- The parser interprets structured evidence but cannot cryptographically authenticate the source of untrusted input.
- Transaction ID is local to Vietcombank; no cross-bank deduplication is claimed.
