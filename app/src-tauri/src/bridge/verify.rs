//! Parse-free verification of a returned Stellar transaction envelope (W4b/W5a).
//!
//! The bridge does not trust the browser page's own verification (that is only
//! defence in depth): Rust re-checks the envelope independently before an
//! outcome is reported as `ok`. No XDR crate is needed because a v1
//! `TransactionEnvelope` is
//!
//! ```text
//! [envelope type: 00000002][Transaction body …][signature count][decorations…]
//! ```
//!
//! so the body is a byte slice, the source key / fee / sequence sit at fixed
//! offsets in it, and the transaction hash is `SHA-256(networkId || 00000002 ||
//! body)` where `networkId = SHA-256(networkPassphrase)` — the same hash the JS
//! SDK's `Transaction.hash()` produces (pinned by [`FIXTURE_HASH`]).
//!
//! The signature list is located from the end by structure
//! ([`find_signature_list`]), so one reader handles an unsigned input (W4b), a
//! SEP-10 challenge carrying the anchor's signature, and that challenge after the
//! wallet adds its own (W5a). [`verify_signed`] requires the unsigned→one-signature
//! transition; [`verify_challenge`] requires the one→two-signature transition plus
//! the sequence-0 / non-owner-source shape. Any deviation is an integrity failure,
//! never a partial success.
//!
//! ## Residual risk: challenge operation types are not parsed
//!
//! A SEP-10 challenge should contain only `manage_data` operations, but a v1
//! `Transaction` puts a variable-length `Preconditions` structure between the
//! sequence number and the `memo`/operation list (`none` = 4 bytes, `time` = 20,
//! `v2` = optional sub-structures plus a signer list), so the operation count is
//! not at a fixed offset and walking it parse-free would mean reimplementing much
//! of the XDR schema. Per the W5a task's explicit fallback, the op-type check is
//! **not** done. The login stays safe because: the challenge is sequence 0 (the
//! signed bytes can never be applied on-chain — [`verify_challenge`]); the anchor
//! is trusted to run SEP-10 and verifies the challenge's own body before treating
//! the added signature as proof of login; and Polaris never submits the
//! challenge. A malicious anchor could gain a signature over a sequence-0
//! transaction it chose, which is outside Polaris's trust boundary.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

/// Envelope type for a plain (non-fee-bump) transaction.
pub const ENVELOPE_TYPE_TX: [u8; 4] = [0, 0, 0, 2];
/// `CryptoKeyType::KEY_TYPE_ED25519`.
pub const KEY_TYPE_ED25519: [u8; 4] = [0, 0, 0, 0];
/// Exactly one `DecoratedSignature`.
pub const SIGNATURE_COUNT_ONE: [u8; 4] = [0, 0, 0, 1];
/// Ed25519 signatures are 64 bytes.
pub const SIGNATURE_LEN: [u8; 4] = [0, 0, 0, 64];
/// The maximum number of `DecoratedSignature`s the parser looks for when it
/// finds the signature list from the end. SEP-10 challenges carry one (the
/// anchor's) plus the wallet's; four leaves generous room while bounding the
/// search.
pub const MAX_SIGNATURES: usize = 4;
/// Bytes per `DecoratedSignature`: `hint(4) || signatureLen(4) || signature(64)`.
const DECORATION_LEN: usize = 72;

/// Byte offsets inside the full envelope (envelope type included).
const SOURCE_KEY_TYPE: usize = 4;
const SOURCE_KEY: usize = 8;
const FEE: usize = 40;
const SEQUENCE: usize = 44;
/// Bytes preceding the signature list once the 4-byte count is removed.
const BODY_OFFSET: usize = 4;
/// One `DecoratedSignature`: a 4-byte key hint and a 64-byte Ed25519 signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecoratedSignature {
    pub hint: [u8; 4],
    pub signature: [u8; 64],
}

/// A parsed v1 transaction envelope, with its signature list located by
/// structure (not by a fixed assumption), so an unsigned input, a one-signature
/// challenge and a two-signature signed challenge all parse through one reader.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedEnvelope<'a> {
    /// The full envelope, including the 4-byte type and the signature list.
    pub full: &'a [u8],
    /// The `Transaction` body: `full[4 .. signature_list_start]`.
    pub body: &'a [u8],
    /// The transaction source account's Ed25519 public key.
    pub source: [u8; 32],
    /// The transaction sequence number (int64 big-endian at offset 44).
    pub sequence: i64,
    /// The fee (uint32 big-endian at offset 40).
    pub fee: u32,
    /// Every parsed `DecoratedSignature`, in envelope order.
    pub signatures: Vec<DecoratedSignature>,
}

/// A parsed unsigned v1 transaction envelope. Keep the name the W4b code uses;
/// it now also carries the (empty) signature list.
pub type UnsignedEnvelope<'a> = ParsedEnvelope<'a>;

/// Why an envelope did not verify. Every variant is surfaced as `integrity` by
/// the bridge, with [`VerifyError::detail`] as the one-sentence explanation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    /// Not a base64 string.
    NotBase64,
    /// Too short to hold an envelope type, source account and signature count.
    Truncated,
    /// The first four bytes are not the transaction envelope type (e.g. a
    /// fee-bump, which is deliberately refused).
    NotTransactionEnvelope,
    /// The trailing signature count is not zero: this is not the unsigned input.
    NotUnsigned,
    /// The source account is not an Ed25519 key.
    NotEd25519Source,
    /// The signed envelope does not carry exactly one signature.
    SignedNotOneSignature,
    /// The signed envelope's body bytes differ from the unsigned input.
    BodyMismatch,
    /// The signature hint is not the last four bytes of the expected key.
    KeyHintMismatch,
    /// The expected key is not a valid Ed25519 point.
    WrongPublicKey,
    /// The Ed25519 signature does not verify over the transaction hash.
    SignatureInvalid,
    /// The signature list could not be located (count, length or hint layout).
    MalformedSignatures,
    /// A challenge must have sequence number exactly 0.
    ChallengeNonZeroSequence,
    /// A challenge must already carry the anchor's signature.
    ChallengeNoServerSignature,
    /// A challenge must not have the owner as its source account.
    ChallengeOwnerSource,
}

impl VerifyError {
    /// One actionable sentence for the outcome's `message`.
    pub fn detail(&self) -> String {
        match self {
            Self::NotBase64 => "the transaction envelope is not valid base64".to_string(),
            Self::Truncated => "the transaction envelope is truncated".to_string(),
            Self::NotTransactionEnvelope => {
                "the envelope is not a plain transaction (fee-bump envelopes are refused)"
                    .to_string()
            }
            Self::NotUnsigned => "the envelope is not an unsigned transaction".to_string(),
            Self::NotEd25519Source => {
                "the transaction source account is not an Ed25519 key".to_string()
            }
            Self::SignedNotOneSignature => {
                "the signed envelope does not carry exactly one signature".to_string()
            }
            Self::BodyMismatch => {
                "the signed transaction is not the unsigned transaction".to_string()
            }
            Self::KeyHintMismatch => "the signature is not by the expected account".to_string(),
            Self::WrongPublicKey => "the expected account key is not a valid Ed25519 key".to_string(),
            Self::SignatureInvalid => "the transaction signature is not valid".to_string(),
            Self::MalformedSignatures => {
                "the envelope's signature list is malformed".to_string()
            }
            Self::ChallengeNonZeroSequence => {
                "the challenge sequence number is not 0, so it could be applied on-chain".to_string()
            }
            Self::ChallengeNoServerSignature => {
                "the challenge does not carry the anchor's signature".to_string()
            }
            Self::ChallengeOwnerSource => {
                "the challenge source account is the owner, so signing it would authorize an owner transaction".to_string()
            }
        }
    }
}

/// Decodes a base64 transaction envelope.
pub fn decode_envelope(base64_xdr: &str) -> Result<Vec<u8>, VerifyError> {
    BASE64
        .decode(base64_xdr.trim())
        .map_err(|_| VerifyError::NotBase64)
}

/// Locates the `DecoratedSignature` array at the end of a v1 transaction
/// envelope by validating its structure, **for each candidate count in
/// `0..=MAX_SIGNATURES`**, rather than assuming a fixed count.
///
/// A challenge arrives with the anchor's signature(s); an unsigned input has an
/// empty list; a wallet-signed challenge has one more. The list is therefore
/// found from the end: for a candidate count `c`, the last `c * 76 + 4` bytes
/// must be `c` decorations of `hint(4) || 00000040 || signature(64)`. The first
/// structurally valid count wins. Returns the byte offset of the 4-byte count
/// and the parsed decorations, or `MalformedSignatures` when nothing fits.
fn find_signature_list(full: &[u8]) -> Result<(usize, Vec<DecoratedSignature>), VerifyError> {
    for count in 0..=MAX_SIGNATURES {
        // The tail is `[count: 4][decorations: count * 72]`.
        let list_start = match full.len().checked_sub(count * DECORATION_LEN + 4) {
            Some(start) => start,
            None => continue,
        };
        if full[list_start..list_start + 4] != (count as u32).to_be_bytes() {
            continue;
        }
        let mut signatures = Vec::with_capacity(count);
        let mut valid = true;
        for index in 0..count {
            let at = list_start + 4 + index * DECORATION_LEN;
            let hint = &full[at..at + 4];
            if full[at + 4..at + 8] != SIGNATURE_LEN {
                valid = false;
                break;
            }
            let mut parsed = DecoratedSignature {
                hint: [0u8; 4],
                signature: [0u8; 64],
            };
            parsed.hint.copy_from_slice(hint);
            parsed.signature.copy_from_slice(&full[at + 8..at + 72]);
            signatures.push(parsed);
        }
        if valid {
            return Ok((list_start, signatures));
        }
    }
    Err(VerifyError::MalformedSignatures)
}

/// Parses a v1 transaction envelope, validating the prefix, the structure-located
/// signature list, and the fixed-offset source key, fee and sequence fields.
///
/// The signature list is found by [`find_signature_list`], so this accepts an
/// unsigned, one-signature or two-signature envelope. `parse_unsigned` is the
/// stricter wrapper that additionally requires the list to be empty.
pub fn parse_envelope(full: &[u8]) -> Result<ParsedEnvelope<'_>, VerifyError> {
    if full.len() < SEQUENCE + 8 + 4 {
        return Err(VerifyError::Truncated);
    }
    if full[..4] != ENVELOPE_TYPE_TX {
        return Err(VerifyError::NotTransactionEnvelope);
    }
    if full[SOURCE_KEY_TYPE..SOURCE_KEY] != KEY_TYPE_ED25519 {
        return Err(VerifyError::NotEd25519Source);
    }
    let (list_start, signatures) = find_signature_list(full)?;
    let mut source = [0u8; 32];
    source.copy_from_slice(&full[SOURCE_KEY..SOURCE_KEY + 32]);
    let mut fee_bytes = [0u8; 4];
    fee_bytes.copy_from_slice(&full[FEE..FEE + 4]);
    let mut sequence_bytes = [0u8; 8];
    sequence_bytes.copy_from_slice(&full[SEQUENCE..SEQUENCE + 8]);
    let body = &full[BODY_OFFSET..list_start];
    Ok(ParsedEnvelope {
        full,
        body,
        source,
        sequence: i64::from_be_bytes(sequence_bytes),
        fee: u32::from_be_bytes(fee_bytes),
        signatures,
    })
}

/// Parses an **unsigned** v1 transaction envelope: the general parser plus the
/// requirement that the signature list is empty. This is what the normal
/// `bridge_sign` flow releases from the gate.
pub fn parse_unsigned(full: &[u8]) -> Result<UnsignedEnvelope<'_>, VerifyError> {
    let parsed = parse_envelope(full)?;
    if !parsed.signatures.is_empty() {
        return Err(VerifyError::NotUnsigned);
    }
    Ok(parsed)
}

/// The Stellar transaction (signature-base) hash: `SHA-256(SHA-256(passphrase) ||
/// 00000002 || body)`. Lowercase hex is what appears on stellar.expert.
pub fn tx_hash(body: &[u8], network_passphrase: &str) -> [u8; 32] {
    let network_id = Sha256::digest(network_passphrase.as_bytes());
    let mut hasher = Sha256::new();
    hasher.update(network_id);
    hasher.update(ENVELOPE_TYPE_TX);
    hasher.update(body);
    hasher.finalize().into()
}

/// Lowercase hex of a transaction hash.
#[cfg(test)]
pub fn tx_hash_hex(body: &[u8], network_passphrase: &str) -> String {
    hex::encode(tx_hash(body, network_passphrase))
}

/// Verifies that `signed_base64` is the same transaction as `unsigned_base64`,
/// signed by exactly one Ed25519 key whose hint and signature match `key`, over
/// `network_passphrase`. Returns the transaction hash on success.
pub fn verify_signed(
    unsigned_base64: &str,
    signed_base64: &str,
    key: &[u8; 32],
    network_passphrase: &str,
) -> Result<[u8; 32], VerifyError> {
    let unsigned_bytes = decode_envelope(unsigned_base64)?;
    let unsigned = parse_unsigned(&unsigned_bytes)?;
    let signed = decode_envelope(signed_base64)?;

    // The signed envelope must be the unsigned prefix (`type || body`, with the
    // trailing zero signature count removed) followed by exactly one signature:
    // `00000001 || hint(4) || 00000040 || signature(64)`.
    let prefix_len = unsigned.full.len() - 4;
    let expected_signed_len = prefix_len + 4 + 4 + 4 + 64;
    if signed.len() != expected_signed_len {
        return Err(VerifyError::SignedNotOneSignature);
    }
    if signed[..prefix_len] != unsigned.full[..prefix_len] {
        return Err(VerifyError::BodyMismatch);
    }
    if signed[prefix_len..prefix_len + 4] != SIGNATURE_COUNT_ONE {
        return Err(VerifyError::SignedNotOneSignature);
    }
    let hint = &signed[prefix_len + 4..prefix_len + 8];
    if signed[prefix_len + 8..prefix_len + 12] != SIGNATURE_LEN {
        return Err(VerifyError::SignedNotOneSignature);
    }
    if hint != &key[28..32] {
        return Err(VerifyError::KeyHintMismatch);
    }
    let signature_bytes: [u8; 64] = signed[prefix_len + 12..prefix_len + 76]
        .try_into()
        .map_err(|_| VerifyError::Truncated)?;
    let signature = Signature::from_bytes(&signature_bytes);

    let verifying_key = VerifyingKey::from_bytes(key).map_err(|_| VerifyError::WrongPublicKey)?;
    let hash = tx_hash(unsigned.body, network_passphrase);
    verifying_key
        .verify_strict(&hash, &signature)
        .map_err(|_| VerifyError::SignatureInvalid)?;
    Ok(hash)
}

/// Independently verifies a returned **SEP-10 challenge** signature.
///
/// The signed input is the anchor's challenge envelope and the output is that
/// same challenge plus exactly one more signature, by `owner`. The challenge is
/// safe to sign without a biometric prompt only under a narrow shape, all of
/// which is enforced here from the raw bytes (no XDR crate):
///
/// * the envelope is a v1 transaction envelope;
/// * its sequence number is exactly `0` (so it can never be applied on-chain);
/// * the source account is **not** `owner` (signing a transaction sourced by the
///   owner could authorize an owner action, even one that some abuse of the
///   challenge flow made it sign);
/// * the challenge already carries **exactly one** signature (the anchor's), and
///   the signed challenge keeps the challenge's body bytes byte-for-byte, keeps
///   that signature, and adds exactly one more whose hint and Ed25519 signature
///   match `owner` over the transaction hash (so 1 → 2 signatures).
///
/// On success returns the transaction hash. Any deviation is an integrity error.
pub fn verify_challenge(
    challenge_base64: &str,
    signed_base64: &str,
    owner: &[u8; 32],
    network_passphrase: &str,
) -> Result<[u8; 32], VerifyError> {
    let challenge_bytes = decode_envelope(challenge_base64)?;
    let challenge = parse_envelope(&challenge_bytes)?;

    if challenge.sequence != 0 {
        return Err(VerifyError::ChallengeNonZeroSequence);
    }
    if challenge.source == *owner {
        return Err(VerifyError::ChallengeOwnerSource);
    }
    if challenge.signatures.len() != 1 {
        return Err(VerifyError::ChallengeNoServerSignature);
    }
    // The operation list is deliberately not walked here; see the module docs
    // ("Residual risk: challenge operation types are not parsed").

    let signed_bytes = decode_envelope(signed_base64)?;
    let signed = parse_envelope(&signed_bytes)?;
    // Same transaction: the body (everything between the type and the signature
    // list) must be byte-identical.
    if signed.full[..4] != challenge.full[..4] || signed.body != challenge.body {
        return Err(VerifyError::BodyMismatch);
    }
    if signed.signatures.len() != challenge.signatures.len() + 1 {
        return Err(VerifyError::SignedNotOneSignature);
    }

    // The wallet's signature must be the last one (the challenge's signatures are
    // kept, and exactly one is appended). Compare the retained decorations.
    let kept = &signed.signatures[..challenge.signatures.len()];
    if kept != challenge.signatures.as_slice() {
        return Err(VerifyError::MalformedSignatures);
    }
    let added = signed.signatures.last().ok_or(VerifyError::MalformedSignatures)?;
    if added.hint != owner[28..32] {
        return Err(VerifyError::KeyHintMismatch);
    }

    let verifying_key = VerifyingKey::from_bytes(owner).map_err(|_| VerifyError::WrongPublicKey)?;
    let hash = tx_hash(challenge.body, network_passphrase);
    let signature = Signature::from_bytes(&added.signature);
    verifying_key
        .verify_strict(&hash, &signature)
        .map_err(|_| VerifyError::SignatureInvalid)?;
    Ok(hash)
}

/// Test-only helpers shared with the server tests: building a valid signed
/// envelope for the fixture without duplicating the decoration format.
#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// The real unsigned testnet payment used across the bridge tests.
    pub const FIXTURE_XDR: &str = "AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA";
    /// The fixture's signature-base hash, from `@stellar/stellar-sdk`.
    #[allow(dead_code)] // Used by the module's own tests and the JS vector.
    pub const FIXTURE_HASH: &str =
        "28db72cef390f4490ce4b4d05ae67c90aefa10d9e11437e14476830f68bfde46";
    /// The fixture's source key (`GAJW…`) as raw bytes.
    pub const OWNER_KEY: [u8; 32] = [
        0x13, 0x6e, 0xd7, 0xf5, 0xb9, 0xd1, 0x19, 0xa4, 0x26, 0x6d, 0x71, 0x33, 0x5d, 0x3e,
        0x12, 0xc6, 0xcf, 0xa0, 0x88, 0x78, 0x30, 0x3d, 0xdd, 0x6a, 0x54, 0xd4, 0x95, 0x3e,
        0x21, 0xc3, 0xa6, 0x01,
    ];
    /// The test network passphrase.
    pub const PASSPHRASE: &str = "Test SDF Network ; September 2015";

    /// Signs `unsigned_base64` with the key derived from `seed`, producing an
    /// envelope with exactly one `DecoratedSignature`.
    pub fn sign_with(unsigned_base64: &str, seed: [u8; 32]) -> String {
        let key = SigningKey::from_bytes(&seed);
        let full = decode_envelope(unsigned_base64).unwrap();
        let parsed = parse_unsigned(&full).unwrap();
        let hash = tx_hash(parsed.body, PASSPHRASE);
        let signature = key.sign(&hash);
        let hint = &key.verifying_key().to_bytes()[28..32];
        let mut out = Vec::with_capacity(full.len() + 76);
        out.extend_from_slice(&full[..full.len() - 4]);
        out.extend_from_slice(&SIGNATURE_COUNT_ONE);
        out.extend_from_slice(hint);
        out.extend_from_slice(&SIGNATURE_LEN);
        out.extend_from_slice(&signature.to_bytes());
        BASE64.encode(out)
    }

    /// Signs the module's fixture with `seed`.
    pub fn sign_fixture(seed: [u8; 32]) -> String {
        sign_with(FIXTURE_XDR, seed)
    }

    /// Rewrites the fixture's source key (offset 8) and sequence (offset 44) and
    /// re-encodes it, so a test can own the envelope with any keypair.
    pub fn fixture_with_source(source: [u8; 32], sequence: i64) -> String {
        let mut bytes = decode_envelope(FIXTURE_XDR).unwrap();
        bytes[8..40].copy_from_slice(&source);
        bytes[44..52].copy_from_slice(&sequence.to_be_bytes());
        BASE64.encode(bytes)
    }

    /// A SEP-10-shaped testnet challenge generated with `@stellar/stellar-sdk`
    /// 17.1.0: `Account(anchor, "-1")` (the SDK adds 1, so the built sequence is
    /// exactly 0) plus two `manageData` operations (`polaris.example auth`,
    /// `web_auth_domain`), then `tx.sign(anchor)`. The anchor key is seed
    /// `[11u8; 32]`, the owner (wallet) key seed `[7u8; 32]`.
    pub const CHALLENGE_XDR: &str = "AAAAAgAAAABmvn4zLHpFMzK9nQp/fbBV9cXvGgatpm2Ys5+2gQxHOgAAAMgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAABqrzTqAAAAAAAAAAIAAAAAAAAACgAAABRwb2xhcmlzLmV4YW1wbGUgYXV0aAAAAAEAAAAMWTJoaGJHeGxibWRsAAAAAAAAAAoAAAAPd2ViX2F1dGhfZG9tYWluAAAAAAEAAAAUY0c5c1lYSnBjeTVsZUdGdGNHeGwAAAAAAAAAAYEMRzoAAABAOE6h9SMA00P9N598rvy4cTNhlbSRf1L8zPjJgjFNQZhv1ng+Y6gyuKPdD+1eqK9cGGQSqKBuVmvw2hIxF2zgDA==";
    /// The challenge's owner key (the wallet that must sign), raw bytes.
    pub const CHALLENGE_OWNER: [u8; 32] = [
        0xea, 0x4a, 0x6c, 0x63, 0xe2, 0x9c, 0x52, 0x0a, 0xbe, 0xf5, 0x50, 0x7b, 0x13, 0x2e,
        0xc5, 0xf9, 0x95, 0x47, 0x76, 0xae, 0xbe, 0xbe, 0x7b, 0x92, 0x42, 0x1e, 0xea, 0x69,
        0x14, 0x46, 0xd2, 0x2c,
    ];
    /// The challenge's anchor source key, raw bytes.
    pub const CHALLENGE_ANCHOR: [u8; 32] = [
        0x66, 0xbe, 0x7e, 0x33, 0x2c, 0x7a, 0x45, 0x33, 0x32, 0xbd, 0x9d, 0x0a, 0x7f, 0x7d,
        0xb0, 0x55, 0xf5, 0xc5, 0xef, 0x1a, 0x06, 0xad, 0xa6, 0x6d, 0x98, 0xb3, 0x9f, 0xb6,
        0x81, 0x0c, 0x47, 0x3a,
    ];
    /// The challenge's signature-base hash, from `@stellar/stellar-sdk`.
    pub const CHALLENGE_HASH: &str =
        "07a83694353478aefd7389b5b70f97ca90093810295a2df840b3a7909bda3892";
    /// The owner seed used to generate the wallet signature in
    /// [`CHALLENGE_XDR`]'s `walletSignedXdr` (`[7u8; 32]`).
    pub const CHALLENGE_OWNER_SEED: [u8; 32] = [7u8; 32];

    /// Appends one `DecoratedSignature` by `seed` over the *existing* envelope's
    /// body, keeping every stored signature. Used to model a wallet adding its
    /// signature to a challenge without needing the anchor's private key.
    pub fn add_signature_existing(existing_base64: &str, seed: [u8; 32]) -> String {
        use ed25519_dalek::Signer;
        let key = SigningKey::from_bytes(&seed);
        let full = decode_envelope(existing_base64).unwrap();
        let parsed = parse_envelope(&full).unwrap();
        let hash = tx_hash(parsed.body, PASSPHRASE);
        let signature = key.sign(&hash);
        let hint = &key.verifying_key().to_bytes()[28..32];
        let list_start = parsed.full.len() - (parsed.signatures.len() * DECORATION_LEN + 4);
        let mut out = Vec::with_capacity(full.len() + DECORATION_LEN);
        out.extend_from_slice(&full[..list_start]);
        let new_count = (parsed.signatures.len() as u32 + 1).to_be_bytes();
        out.extend_from_slice(&new_count);
        for sig in &parsed.signatures {
            out.extend_from_slice(&sig.hint);
            out.extend_from_slice(&SIGNATURE_LEN);
            out.extend_from_slice(&sig.signature);
        }
        out.extend_from_slice(hint);
        out.extend_from_slice(&SIGNATURE_LEN);
        out.extend_from_slice(&signature.to_bytes());
        BASE64.encode(out)
    }

    /// Rewrites the challenge's source key (offset 8) and sequence (offset 44)
    /// while keeping its stored signatures structurally intact (the signature
    /// bytes become invalid, which is fine for shape tests).
    pub fn challenge_with_source_and_sequence(source: [u8; 32], sequence: i64) -> String {
        let mut bytes = decode_envelope(CHALLENGE_XDR).unwrap();
        bytes[8..40].copy_from_slice(&source);
        bytes[44..52].copy_from_slice(&sequence.to_be_bytes());
        BASE64.encode(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// A real unsigned testnet XLM payment (owner -> acc2, fee 100, sequence 1)
    /// generated with `@stellar/stellar-sdk`; the hash pins [`tx_hash`] to the JS
    /// SDK's `Transaction.hash()`.
    const FIXTURE_XDR: &str = "AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA";
    const FIXTURE_HASH: &str = "28db72cef390f4490ce4b4d05ae67c90aefa10d9e11437e14476830f68bfde46";
    /// The fixture's source account (`GAJW…`) as raw key bytes.
    const OWNER_KEY: [u8; 32] = [
        0x13, 0x6e, 0xd7, 0xf5, 0xb9, 0xd1, 0x19, 0xa4, 0x26, 0x6d, 0x71, 0x33, 0x5d, 0x3e,
        0x12, 0xc6, 0xcf, 0xa0, 0x88, 0x78, 0x30, 0x3d, 0xdd, 0x6a, 0x54, 0xd4, 0x95, 0x3e,
        0x21, 0xc3, 0xa6, 0x01,
    ];
    const PASSPHRASE: &str = "Test SDF Network ; September 2015";
    /// A fixed seed for the test signing key, so every test is deterministic.
    const TEST_SEED: [u8; 32] = [7u8; 32];

    fn test_key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SEED)
    }

    /// Builds a valid signed envelope for `unsigned_base64` with `key`, carrying
    /// exactly one `DecoratedSignature`.
    fn sign(unsigned_base64: &str, key: &SigningKey) -> String {
        let full = decode_envelope(unsigned_base64).unwrap();
        let parsed = parse_unsigned(&full).unwrap();
        let hash = tx_hash(parsed.body, PASSPHRASE);
        let signature = key.sign(&hash);
        let hint = &key.verifying_key().to_bytes()[28..32];
        let mut out = Vec::with_capacity(full.len() + 76);
        out.extend_from_slice(&full[..full.len() - 4]);
        out.extend_from_slice(&SIGNATURE_COUNT_ONE);
        out.extend_from_slice(hint);
        out.extend_from_slice(&SIGNATURE_LEN);
        out.extend_from_slice(&signature.to_bytes());
        BASE64.encode(out)
    }

    /// Replaces the source key (offset 8) and sequence (offset 44) of the fixture
    /// and re-encodes it, so the parse-free checks can be exercised with any
    /// source/sequence combination.
    fn patch_fixture(source: Option<[u8; 32]>, sequence: Option<i64>) -> String {
        let mut bytes = decode_envelope(FIXTURE_XDR).unwrap();
        if let Some(key) = source {
            bytes[SOURCE_KEY..SOURCE_KEY + 32].copy_from_slice(&key);
        }
        if let Some(seq) = sequence {
            bytes[SEQUENCE..SEQUENCE + 8].copy_from_slice(&seq.to_be_bytes());
        }
        BASE64.encode(bytes)
    }

    #[test]
    fn transaction_hash_matches_the_js_sdk_vector() {
        let bytes = decode_envelope(FIXTURE_XDR).unwrap();
        let parsed = parse_unsigned(&bytes).unwrap();
        assert_eq!(tx_hash_hex(parsed.body, PASSPHRASE), FIXTURE_HASH);
    }

    #[test]
    fn parses_the_fixture_source_sequence_and_fee() {
        let bytes = decode_envelope(FIXTURE_XDR).unwrap();
        let parsed = parse_unsigned(&bytes).unwrap();
        assert_eq!(parsed.source, OWNER_KEY);
        assert_eq!(parsed.sequence, 1);
        assert_eq!(parsed.fee, 100);
        assert_eq!(&parsed.full[..4], &ENVELOPE_TYPE_TX);
        assert_eq!(&parsed.full[parsed.full.len() - 4..], &[0, 0, 0, 0]);
    }

    #[test]
    fn verifies_an_honest_signature() {
        let signed = sign(FIXTURE_XDR, &test_key());
        let hash = verify_signed(
            FIXTURE_XDR,
            &signed,
            &test_key().verifying_key().to_bytes(),
            PASSPHRASE,
        )
        .unwrap();
        assert_eq!(hex::encode(hash), FIXTURE_HASH);
    }

    #[test]
    fn rejects_a_wrong_owner_key() {
        let signed = sign(FIXTURE_XDR, &test_key());
        // Different key: the hint no longer matches.
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(
            verify_signed(FIXTURE_XDR, &signed, &other.verifying_key().to_bytes(), PASSPHRASE),
            Err(VerifyError::KeyHintMismatch)
        );
    }

    #[test]
    fn rejects_a_wrong_passphrase() {
        let signed = sign(FIXTURE_XDR, &test_key());
        assert_eq!(
            verify_signed(
                FIXTURE_XDR,
                &signed,
                &test_key().verifying_key().to_bytes(),
                "Public Global Stellar Network ; September 2015",
            ),
            Err(VerifyError::SignatureInvalid)
        );
    }

    #[test]
    fn rejects_a_tampered_signature() {
        let signed = sign(FIXTURE_XDR, &test_key());
        let mut bytes = decode_envelope(&signed).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        let tampered = BASE64.encode(bytes);
        assert_eq!(
            verify_signed(
                FIXTURE_XDR,
                &tampered,
                &test_key().verifying_key().to_bytes(),
                PASSPHRASE
            ),
            Err(VerifyError::SignatureInvalid)
        );
    }

    #[test]
    fn rejects_a_reordered_or_tampered_body() {
        // The page returns a *different* transaction: same source and operation
        // count, but a flipped byte inside the body. The signed-vs-unsigned byte
        // comparison must catch it before any signature check.
        let mut bytes = decode_envelope(FIXTURE_XDR).unwrap();
        bytes[60] ^= 0x01;
        let different = BASE64.encode(bytes);
        let signed = sign(&different, &test_key());
        assert_eq!(
            verify_signed(
                FIXTURE_XDR,
                &signed,
                &test_key().verifying_key().to_bytes(),
                PASSPHRASE
            ),
            Err(VerifyError::BodyMismatch)
        );
    }

    #[test]
    fn rejects_an_extra_signature() {
        let signed = sign(FIXTURE_XDR, &test_key());
        let mut bytes = decode_envelope(&signed).unwrap();
        // Claim a second signature and append another 76-byte decoration.
        let count_at = bytes.len() - 76;
        bytes[count_at..count_at + 4].copy_from_slice(&[0, 0, 0, 2]);
        let extra = bytes[count_at + 4..count_at + 76].to_vec();
        bytes.extend_from_slice(&extra);
        let extra_signed = BASE64.encode(bytes);
        assert_eq!(
            verify_signed(
                FIXTURE_XDR,
                &extra_signed,
                &test_key().verifying_key().to_bytes(),
                PASSPHRASE
            ),
            Err(VerifyError::SignedNotOneSignature)
        );
    }

    #[test]
    fn rejects_a_truncated_envelope() {
        let full = decode_envelope(FIXTURE_XDR).unwrap();
        assert_eq!(parse_unsigned(&full[..20]), Err(VerifyError::Truncated));
        // A fragment is still decodable base64 bytes, but never a valid envelope.
        let half = decode_envelope(&FIXTURE_XDR[..16]).unwrap();
        assert_eq!(parse_unsigned(&half), Err(VerifyError::Truncated));
        // Non-base64 input is rejected before parsing.
        assert_eq!(decode_envelope("not base64 !!!"), Err(VerifyError::NotBase64));
        assert_eq!(decode_envelope("###"), Err(VerifyError::NotBase64));
    }

    #[test]
    fn rejects_a_fee_bump_or_non_transaction_envelope() {
        let mut bytes = decode_envelope(FIXTURE_XDR).unwrap();
        bytes[3] = 5;
        assert_eq!(
            parse_unsigned(&bytes),
            Err(VerifyError::NotTransactionEnvelope)
        );
    }

    #[test]
    fn rejects_an_already_signed_envelope_as_unsigned() {
        let signed = sign(FIXTURE_XDR, &test_key());
        let bytes = decode_envelope(&signed).unwrap();
        assert_eq!(parse_unsigned(&bytes), Err(VerifyError::NotUnsigned));
    }

    #[test]
    fn rejects_a_non_ed25519_source() {
        let mut bytes = decode_envelope(FIXTURE_XDR).unwrap();
        bytes[SOURCE_KEY_TYPE] = 1;
        assert_eq!(parse_unsigned(&bytes), Err(VerifyError::NotEd25519Source));
    }

    #[test]
    fn verify_signed_requires_an_unsigned_input() {
        let signed = sign(FIXTURE_XDR, &test_key());
        assert_eq!(
            verify_signed(
                &signed,
                &signed,
                &test_key().verifying_key().to_bytes(),
                PASSPHRASE
            ),
            Err(VerifyError::NotUnsigned)
        );
    }

    #[test]
    fn a_patched_sequence_zero_envelope_is_parseable_and_still_verifies() {
        // The self-test requires sequence 0; the parse-free reader must see it.
        let patched = patch_fixture(Some(OWNER_KEY), Some(0));
        let bytes = decode_envelope(&patched).unwrap();
        let parsed = parse_unsigned(&bytes).unwrap();
        assert_eq!(parsed.sequence, 0);
        assert_eq!(parsed.source, OWNER_KEY);

        let signed = {
            let key = test_key();
            let hash = tx_hash(parsed.body, PASSPHRASE);
            let signature = key.sign(&hash);
            let hint = &key.verifying_key().to_bytes()[28..32];
            let mut out = Vec::new();
            out.extend_from_slice(&bytes[..bytes.len() - 4]);
            out.extend_from_slice(&SIGNATURE_COUNT_ONE);
            out.extend_from_slice(hint);
            out.extend_from_slice(&SIGNATURE_LEN);
            out.extend_from_slice(&signature.to_bytes());
            BASE64.encode(out)
        };
        assert!(verify_signed(&patched, &signed, &test_key().verifying_key().to_bytes(), PASSPHRASE).is_ok());
    }

    #[test]
    fn patch_fixture_changes_the_source() {
        let patched = patch_fixture(Some([0xABu8; 32]), None);
        let bytes = decode_envelope(&patched).unwrap();
        assert_eq!(parse_unsigned(&bytes).unwrap().source, [0xABu8; 32]);
    }

    #[test]
    fn finds_the_signature_list_for_every_count() {
        // The challenge carries the anchor's signature; the same body re-parsed
        // after the wallet adds one must locate a two-signature list, not assume
        // an empty one. This is the generalisation the task asks for.
        let one = decode_envelope(tests_support::CHALLENGE_XDR).unwrap();
        let parsed_one = parse_envelope(&one).unwrap();
        assert_eq!(parsed_one.signatures.len(), 1);

        let two_b64 = tests_support::add_signature_existing(
            tests_support::CHALLENGE_XDR,
            tests_support::CHALLENGE_OWNER_SEED,
        );
        let two = decode_envelope(&two_b64).unwrap();
        let parsed_two = parse_envelope(&two).unwrap();
        assert_eq!(parsed_two.signatures.len(), 2);
        assert_eq!(parsed_two.signatures[0], parsed_one.signatures[0]);
        assert_eq!(
            parsed_two.signatures[1].hint,
            tests_support::CHALLENGE_OWNER[28..32]
        );
        // An unsigned envelope still reports an empty list.
        let unsigned_bytes = decode_envelope(FIXTURE_XDR).unwrap();
        let unsigned = parse_envelope(&unsigned_bytes).unwrap();
        assert!(unsigned.signatures.is_empty());
    }

    #[test]
    fn a_malformed_signature_list_is_rejected_not_guessed() {
        // Corrupt the length field of the challenge's single decoration: no
        // candidate count in 0..=4 fits, so the list cannot be located.
        let mut bytes = decode_envelope(tests_support::CHALLENGE_XDR).unwrap();
        let len_at = bytes.len() - 68;
        bytes[len_at] = 0x7F;
        assert_eq!(
            parse_envelope(&bytes).map(|_| ()),
            Err(VerifyError::MalformedSignatures)
        );

        // Garbage that is shorter than any envelope header.
        assert_eq!(
            parse_envelope(&decode_envelope(FIXTURE_XDR).unwrap()[..16]),
            Err(VerifyError::Truncated)
        );
        // A body whose bytes match no signature-list count in 0..=4.
        let mut garbage = decode_envelope(FIXTURE_XDR).unwrap();
        // Append four bytes that are neither a count we can satisfy nor a valid
        // decoration tail, so every candidate count fails.
        garbage.extend_from_slice(&[0xAB, 0xCD, 0xEF, 0x01]);
        assert_eq!(parse_envelope(&garbage), Err(VerifyError::MalformedSignatures));
    }

    /// Builds the exact wallet-signed challenge vector generated with
    /// `@stellar/stellar-sdk` (`installChallenge(model)` + `tx.sign(owner)`),
    /// and checks Rust agrees on the transaction hash.
    fn wallet_signed_challenge() -> String {
        tests_support::add_signature_existing(
            tests_support::CHALLENGE_XDR,
            tests_support::CHALLENGE_OWNER_SEED,
        )
    }

    #[test]
    fn challenge_hash_matches_the_js_sdk_vector() {
        let bytes = decode_envelope(tests_support::CHALLENGE_XDR).unwrap();
        let parsed = parse_envelope(&bytes).unwrap();
        assert_eq!(
            tx_hash_hex(parsed.body, PASSPHRASE),
            tests_support::CHALLENGE_HASH
        );
    }

    #[test]
    fn verifies_an_honest_challenge_signature() {
        let signed = wallet_signed_challenge();
        let hash = verify_challenge(
            tests_support::CHALLENGE_XDR,
            &signed,
            &tests_support::CHALLENGE_OWNER,
            PASSPHRASE,
        )
        .unwrap();
        assert_eq!(hex::encode(hash), tests_support::CHALLENGE_HASH);
    }

    #[test]
    fn a_challenge_tampered_signature_is_integrity() {
        let signed = wallet_signed_challenge();
        let mut bytes = decode_envelope(&signed).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        assert_eq!(
            verify_challenge(
                tests_support::CHALLENGE_XDR,
                &BASE64.encode(bytes),
                &tests_support::CHALLENGE_OWNER,
                PASSPHRASE
            ),
            Err(VerifyError::SignatureInvalid)
        );
    }

    #[test]
    fn a_challenge_signed_by_the_wrong_key_is_integrity() {
        // The wallet signs with someone else's key: the hint no longer matches
        // the configured owner.
        let other = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        let signed = tests_support::add_signature_existing(
            tests_support::CHALLENGE_XDR,
            [9u8; 32],
        );
        assert_eq!(
            verify_challenge(
                tests_support::CHALLENGE_XDR,
                &signed,
                &tests_support::CHALLENGE_OWNER,
                PASSPHRASE
            ),
            Err(VerifyError::KeyHintMismatch)
        );
        let _ = other;
    }

    #[test]
    fn a_nonzero_sequence_challenge_is_refused() {
        // The sequence is patched to 1 *before* the owner signs, so the signature
        // itself is valid; the seq-0 rule must still refuse it. The anchor's
        // stored signature is now stale, but sequence is checked first.
        let patched = tests_support::challenge_with_source_and_sequence(
            tests_support::CHALLENGE_ANCHOR,
            1,
        );
        let signed = tests_support::add_signature_existing(&patched, tests_support::CHALLENGE_OWNER_SEED);
        assert_eq!(
            verify_challenge(&patched, &signed, &tests_support::CHALLENGE_OWNER, PASSPHRASE),
            Err(VerifyError::ChallengeNonZeroSequence)
        );
    }

    #[test]
    fn a_challenge_without_the_server_signature_is_refused() {
        // Strip the challenge's stored signature: an envelope shape that is not a
        // SEP-10 challenge.
        let bytes = decode_envelope(tests_support::CHALLENGE_XDR).unwrap();
        let list_start = bytes.len() - (DECORATION_LEN + 4);
        let unsigned = BASE64.encode(&bytes[..list_start]);
        // A wallet signature over the unsigned challenge is a valid Ed25519
        // signature, but the challenge's original signature is missing.
        let signed = {
            let unsigned_bytes = decode_envelope(&unsigned).unwrap();
            let parsed = parse_unsigned(&unsigned_bytes).unwrap();
            let key = ed25519_dalek::SigningKey::from_bytes(&tests_support::CHALLENGE_OWNER_SEED);
            let signature = key.sign(&tx_hash(parsed.body, PASSPHRASE));
            let hint = &key.verifying_key().to_bytes()[28..32];
            let mut out = unsigned_bytes.clone();
            out.truncate(out.len() - 4);
            out.extend_from_slice(&SIGNATURE_COUNT_ONE);
            out.extend_from_slice(hint);
            out.extend_from_slice(&SIGNATURE_LEN);
            out.extend_from_slice(&signature.to_bytes());
            BASE64.encode(out)
        };
        assert_eq!(
            verify_challenge(&unsigned, &signed, &tests_support::CHALLENGE_OWNER, PASSPHRASE),
            Err(VerifyError::ChallengeNoServerSignature)
        );
    }

    #[test]
    fn an_owner_sourced_challenge_is_refused() {
        // The owner is the source: signing it could authorize an owner action.
        let patched = tests_support::challenge_with_source_and_sequence(
            tests_support::CHALLENGE_OWNER,
            0,
        );
        let signed =
            tests_support::add_signature_existing(&patched, tests_support::CHALLENGE_OWNER_SEED);
        assert_eq!(
            verify_challenge(&patched, &signed, &tests_support::CHALLENGE_OWNER, PASSPHRASE),
            Err(VerifyError::ChallengeOwnerSource)
        );
    }

    #[test]
    fn a_challenge_with_two_prior_signatures_is_refused() {
        // The anchor side must present exactly one signature; a challenge with two
        // stored decorations is not the accepted shape.
        let two = tests_support::add_signature_existing(
            tests_support::CHALLENGE_XDR,
            tests_support::CHALLENGE_OWNER_SEED,
        );
        let three = tests_support::add_signature_existing(&two, tests_support::CHALLENGE_OWNER_SEED);
        assert_eq!(
            verify_challenge(&two, &three, &tests_support::CHALLENGE_OWNER, PASSPHRASE),
            Err(VerifyError::ChallengeNoServerSignature)
        );
    }

    #[test]
    fn a_challenge_with_an_extra_signature_is_refused() {
        // Two signatures by the owner on top of the anchor's one.
        let once = wallet_signed_challenge();
        let twice = tests_support::add_signature_existing(&once, tests_support::CHALLENGE_OWNER_SEED);
        assert_eq!(
            verify_challenge(
                tests_support::CHALLENGE_XDR,
                &twice,
                &tests_support::CHALLENGE_OWNER,
                PASSPHRASE
            ),
            Err(VerifyError::SignedNotOneSignature)
        );
    }

    #[test]
    fn a_challenge_payment_body_is_refused() {
        // The real payment fixture (a `payment` op, seq 1) can never be accepted
        // as a challenge.
        let signed = tests_support::add_signature_existing(FIXTURE_XDR, TEST_SEED);
        assert_eq!(
            verify_challenge(
                FIXTURE_XDR,
                &signed,
                &test_key().verifying_key().to_bytes(),
                PASSPHRASE
            ),
            Err(VerifyError::ChallengeNonZeroSequence)
        );
    }
}
