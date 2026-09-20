//! Parse-free verification of a returned Stellar transaction envelope (step W4b).
//!
//! The bridge does not trust the browser page's own verification (that is only
//! defence in depth): Rust re-checks the envelope independently before an
//! outcome is reported as `ok`. No XDR crate is needed because a v1
//! `TransactionEnvelope` with no signatures is just
//!
//! ```text
//! [envelope type: 00000002][Transaction body …][signature count: 00000000]
//! ```
//!
//! so the body is a byte slice, the source key / fee / sequence sit at fixed
//! offsets in it, and the transaction hash is `SHA-256(networkId || 00000002 ||
//! body)` where `networkId = SHA-256(networkPassphrase)` — the same hash the JS
//! SDK's `Transaction.hash()` produces (pinned by [`FIXTURE_HASH`]).
//!
//! A signed envelope produced from that input must be byte-identical up to the
//! signature list and carry exactly one Ed25519 signature whose hint matches the
//! owner's key. Any deviation is an integrity failure, never a partial success.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

/// Envelope type for a plain (non-fee-bump) transaction.
pub const ENVELOPE_TYPE_TX: [u8; 4] = [0, 0, 0, 2];
/// `CryptoKeyType::KEY_TYPE_ED25519`.
pub const KEY_TYPE_ED25519: [u8; 4] = [0, 0, 0, 0];
/// Empty `DecoratedSignature` array.
pub const SIGNATURE_COUNT_EMPTY: [u8; 4] = [0, 0, 0, 0];
/// Exactly one `DecoratedSignature`.
pub const SIGNATURE_COUNT_ONE: [u8; 4] = [0, 0, 0, 1];
/// Ed25519 signatures are 64 bytes.
pub const SIGNATURE_LEN: [u8; 4] = [0, 0, 0, 64];

/// Byte offsets inside the full envelope (envelope type included).
const SOURCE_KEY_TYPE: usize = 4;
const SOURCE_KEY: usize = 8;
const FEE: usize = 40;
const SEQUENCE: usize = 44;
/// Bytes preceding the signature list once the 4-byte count is removed.
const BODY_OFFSET: usize = 4;

/// A parsed unsigned v1 transaction envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsignedEnvelope<'a> {
    /// The full envelope, including the 4-byte type and the empty signature list.
    pub full: &'a [u8],
    /// The `Transaction` body: `full[4 .. len - 4]`.
    pub body: &'a [u8],
    /// The transaction source account's Ed25519 public key.
    pub source: [u8; 32],
    /// The transaction sequence number (int64 big-endian at offset 44).
    pub sequence: i64,
    /// The fee (uint32 big-endian at offset 40).
    pub fee: u32,
}

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
        }
    }
}

/// Decodes a base64 transaction envelope.
pub fn decode_envelope(base64_xdr: &str) -> Result<Vec<u8>, VerifyError> {
    BASE64
        .decode(base64_xdr.trim())
        .map_err(|_| VerifyError::NotBase64)
}

/// Parses an unsigned v1 transaction envelope, validating the prefix, the empty
/// signature list and the fixed-offset source key, fee and sequence fields.
pub fn parse_unsigned(full: &[u8]) -> Result<UnsignedEnvelope<'_>, VerifyError> {
    if full.len() < SEQUENCE + 8 + 4 {
        return Err(VerifyError::Truncated);
    }
    if full[..4] != ENVELOPE_TYPE_TX {
        return Err(VerifyError::NotTransactionEnvelope);
    }
    if full[full.len() - 4..] != SIGNATURE_COUNT_EMPTY {
        return Err(VerifyError::NotUnsigned);
    }
    if full[SOURCE_KEY_TYPE..SOURCE_KEY] != KEY_TYPE_ED25519 {
        return Err(VerifyError::NotEd25519Source);
    }
    let mut source = [0u8; 32];
    source.copy_from_slice(&full[SOURCE_KEY..SOURCE_KEY + 32]);
    let mut fee_bytes = [0u8; 4];
    fee_bytes.copy_from_slice(&full[FEE..FEE + 4]);
    let mut sequence_bytes = [0u8; 8];
    sequence_bytes.copy_from_slice(&full[SEQUENCE..SEQUENCE + 8]);
    let body = &full[BODY_OFFSET..full.len() - 4];
    Ok(UnsignedEnvelope {
        full,
        body,
        source,
        sequence: i64::from_be_bytes(sequence_bytes),
        fee: u32::from_be_bytes(fee_bytes),
    })
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
        assert_eq!(&parsed.full[parsed.full.len() - 4..], &SIGNATURE_COUNT_EMPTY);
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
}
