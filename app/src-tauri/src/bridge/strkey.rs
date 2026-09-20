//! Minimal Stellar StrKey decoding for the bridge's signature check (step W4b).
//!
//! The bridge verifies a returned envelope against the owner's `G...` address, so
//! it has to turn that address into the 32-byte Ed25519 public key the signature
//! is checked against. Stellar public-key StrKeys are `base32(0x30 || key(32) ||
//! crc16(key))`; a shape-only check would accept a single-character typo that
//! keeps the charset, so the CRC16-XModem checksum is validated here (fail
//! closed). The same validation already lives in `stellar_config.rs`; it is
//! duplicated instead of re-exported so the bridge module stays self-contained
//! and testable on its own.
//!
//! No XDR crate and no StrKey crate are used: the whole decoder is these two
//! tiny functions.

/// Version byte for an Ed25519 public key StrKey (`G...`).
pub const PUBLIC_KEY_VERSION: u8 = 0x30;

/// Decodes a `G...` address to its 32-byte Ed25519 public key, or `None` if the
/// length, alphabet, version byte or CRC16-XModem checksum does not match.
pub fn decode_public_key(address: &str) -> Option<[u8; 32]> {
    if address.len() != 56 {
        return None;
    }
    let decoded = base32_decode(address)?;
    // 1 version byte + 32 key bytes + 2 checksum bytes.
    if decoded.len() != 35 || decoded[0] != PUBLIC_KEY_VERSION {
        return None;
    }
    let expected = crc16_xmodem(&decoded[..33]);
    let actual = u16::from_le_bytes([decoded[33], decoded[34]]);
    if expected != actual {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded[1..33]);
    Some(key)
}

/// Decodes RFC 4648 base32 (`A-Z2-7`) without padding, or `None` on a bad char.
fn base32_decode(input: &str) -> Option<Vec<u8>> {
    let mut value: u32 = 0;
    let mut bits: u32 = 0;
    let mut out = Vec::with_capacity(input.len() * 5 / 8);
    for byte in input.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return None,
        };
        value = (value << 5) | u32::from(digit);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((value >> bits) as u8);
        }
    }
    Some(out)
}

/// Test-only inverse of [`decode_public_key`], so bridge tests can build an
/// address that matches a locally generated keypair.
#[cfg(test)]
pub(crate) fn encode_public_key(key: &[u8; 32]) -> String {
    let mut payload = Vec::with_capacity(35);
    payload.push(PUBLIC_KEY_VERSION);
    payload.extend_from_slice(key);
    payload.extend_from_slice(&crc16_xmodem(&payload).to_le_bytes());
    base32_encode(&payload)
}

/// RFC 4648 base32 (`A-Z2-7`) without padding. Test-only counterpart of
/// [`base32_decode`].
#[cfg(test)]
fn base32_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::with_capacity(data.len().div_ceil(5) * 8);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for byte in data {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

/// CRC16-XModem (poly `0x1021`, init 0), the checksum Stellar StrKeys use.
fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for byte in data {
        crc ^= u16::from(*byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A";
    const OWNER_KEY: &str = "136ed7f5b9d119a4266d71335d3e12c6cfa08878303ddd6a54d4953e21c3a601";
    const ACC2: &str = "GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV";
    const ACC2_KEY: &str = "75d810609c224042070db630196ecec948cb9ca47249dd6b891efc0afa0044e8";

    #[test]
    fn decodes_the_two_fixture_addresses_to_their_known_keys() {
        assert_eq!(hex::encode(decode_public_key(OWNER).unwrap()), OWNER_KEY);
        assert_eq!(hex::encode(decode_public_key(ACC2).unwrap()), ACC2_KEY);
    }

    #[test]
    fn encodes_a_known_key_back_to_its_address() {
        let key = decode_public_key(OWNER).unwrap();
        assert_eq!(encode_public_key(&key), OWNER);
    }

    #[test]
    fn rejects_a_shape_valid_address_with_a_bad_checksum() {
        // Last character changed: still 56 base32 chars with a leading `G`, but
        // the CRC16-XModem checksum no longer matches.
        let mutated = "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25B";
        assert!(decode_public_key(mutated).is_none());
    }

    #[test]
    fn rejects_malformed_inputs() {
        for bad in [
            "",
            "not-an-address",
            &OWNER[..55],
            &format!("{OWNER}X"),
            "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25!",
            "gajw5v7vxhirtjbgnvytgxj6cldm7ieipayd3xlkktkjkprbyotac25a",
        ] {
            assert!(decode_public_key(bad).is_none(), "accepted {bad:?}");
        }
    }

    #[test]
    fn rejects_a_contract_or_muxed_address() {
        // `C...` (contract) and `M...` (muxed) are not Ed25519 public keys.
        assert!(decode_public_key("CDRLSFJ5WIC5UMF2LWPF3NRVDOKE7CN3DAYGKDWQ5TJJMVB7FRHRCK4D").is_none());
        assert!(decode_public_key(
            "MAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25AAAAAAAAAAAAAB2M"
        )
        .is_none());
    }
}
