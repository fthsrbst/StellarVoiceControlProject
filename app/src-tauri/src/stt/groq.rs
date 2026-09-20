//! Groq speech-to-text (step A1, cloud-first decision).
//!
//! Groq exposes an OpenAI-compatible transcription endpoint
//! (`POST https://api.groq.com/openai/v1/audio/transcriptions`) that takes a
//! multipart upload. With `response_format=verbose_json` it also reports the
//! **detected language** of the audio, which is the whole point of this backend
//! (step A12): the on-device recognizer is pinned to one locale, so it cannot
//! tell English from Turkish, and the reply language and TTS voice would be
//! poisoned by a wrong guess. The request shape implemented here was re-read
//! from <https://console.groq.com/docs/speech-to-text> while writing this module:
//!
//! * `file` — the audio bytes; 16-bit PCM WAV is supported.
//! * `model` — required; `whisper-large-v3-turbo` is the fast/cheap default.
//! * `language` — optional ISO-639-1 hint. Omitted by default so mixed
//!   Turkish/English commands can be auto-detected (see the A1 report). The
//!   detected language is still returned when a hint is supplied.
//! * `response_format` — `verbose_json`, the only format that carries the
//!   `language` field alongside `text` (a plain `json` response does not).
//!
//! The multipart body is built by hand rather than through a library so the
//! exact bytes are unit-testable and the request never depends on a client's
//! form encoder. The API key is only ever placed in the `Authorization` header;
//! it is never logged, never written to disk and never included in an error.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::env;
use crate::stt::{
    alias_names, decide_language, parse_allowed_languages, resolve_prompt, LanguageDecision,
    SttError, Transcriber, Transcription, ALIASES_ENV, ALLOWED_LANGS_ENV, PROMPT_ENV,
};

/// Default model; override with `POLARIS_STT_MODEL`.
pub const DEFAULT_MODEL: &str = "whisper-large-v3-turbo";

/// The only response format that returns the detected `language` field.
pub const RESPONSE_FORMAT: &str = "verbose_json";

/// The OpenAI-compatible transcription endpoint.
pub const ENDPOINT: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

/// Whole-request budget. The target is well under 2 s; this only stops a stalled
/// connection from pinning the STT worker forever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// How long to wait for the TCP/TLS handshake before giving up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Cap on how much of a provider error body reaches the terminal.
const MAX_ERROR_BODY: usize = 400;

/// One file part of a multipart form.
pub struct MultipartFile<'a> {
    pub field: &'a str,
    pub filename: &'a str,
    pub content_type: &'a str,
    pub bytes: &'a [u8],
}

/// The HTTP seam for the transcription endpoint.
///
/// A trait rather than a concrete call so the F3 language-retry flow can be
/// exercised with scripted answers and no network. [`HttpTransport`] is the
/// production implementation.
pub trait GroqTransport: Send + Sync {
    /// Sends one transcription request and returns the raw 2xx response body.
    fn send(&self, fields: &[(&str, String)], file: MultipartFile<'_>) -> Result<String, SttError>;
}

/// The real `reqwest` transport. The API key lives here and is only ever placed
/// in the `Authorization` header; it is never logged or included in an error.
struct HttpTransport {
    api_key: Option<String>,
    client: reqwest::blocking::Client,
}

impl GroqTransport for HttpTransport {
    fn send(&self, fields: &[(&str, String)], file: MultipartFile<'_>) -> Result<String, SttError> {
        // Defensive: the transcriber checks first, but a transport without a key
        // must never build an anonymous request.
        let Some(key) = self.api_key.as_deref() else {
            return Err(SttError::MissingKey);
        };
        let boundary = boundary();
        let content_type = format!("multipart/form-data; boundary={boundary}");
        let body = multipart_body(&boundary, fields, file);

        let response = self
            .client
            .post(ENDPOINT)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
            .body(body)
            .send()
            .map_err(|error| SttError::Network(error.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .map_err(|error| SttError::Network(error.to_string()))?;
        if !status.is_success() {
            return Err(SttError::Http {
                status: status.as_u16(),
                detail: truncate(&text, MAX_ERROR_BODY),
            });
        }
        Ok(text)
    }
}

/// The Groq backend. Construction never fails: a missing key is a runtime
/// [`SttError::MissingKey`], not a startup error, so capture keeps working.
pub struct GroqTranscriber {
    api_key: Option<String>,
    model: String,
    language: Option<String>,
    /// Vocabulary hint sent as the `prompt` field; `None` sends none (F3).
    prompt: Option<String>,
    /// Languages a detection may keep without the single F3 retry.
    allowed_languages: Vec<String>,
    transport: Arc<dyn GroqTransport>,
}

impl GroqTranscriber {
    /// Reads the key, model, language, vocabulary prompt and allowed languages
    /// from the environment.
    pub fn from_env() -> Self {
        let model = env::var("POLARIS_STT_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_string());
        let mut transcriber =
            Self::new(env::var("GROQ_API_KEY"), model, env::var("POLARIS_STT_LANGUAGE"));
        let aliases = alias_names(env::var(ALIASES_ENV).as_deref());
        transcriber.prompt = resolve_prompt(env::var(PROMPT_ENV).as_deref(), &aliases);
        transcriber.allowed_languages =
            parse_allowed_languages(env::var(ALLOWED_LANGS_ENV).as_deref());
        transcriber
    }

    pub fn new(api_key: Option<String>, model: String, language: Option<String>) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        let transport = Arc::new(HttpTransport {
            api_key: api_key.clone(),
            client,
        });
        Self {
            api_key,
            model,
            language,
            prompt: None,
            allowed_languages: parse_allowed_languages(None),
            transport,
        }
    }

    /// Test seam: an injected transport with a present (fake) key.
    #[cfg(test)]
    fn with_transport(
        transport: Arc<dyn GroqTransport>,
        language: Option<String>,
        prompt: Option<String>,
        allowed_languages: Vec<String>,
    ) -> Self {
        Self {
            api_key: Some("test-key".to_string()),
            model: DEFAULT_MODEL.to_string(),
            language,
            prompt,
            allowed_languages,
            transport,
        }
    }

    /// Whether a key was supplied. Used only for the startup hint; it never
    /// exposes the value.
    pub fn has_key(&self) -> bool {
        self.api_key.is_some()
    }

    /// The model id, for the startup line only. Not secret.
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Runs the request, then applies the F3 language policy: a detection that
    /// is not in the allowed set re-runs the same audio **once** with the first
    /// allowed language. There is no loop.
    fn run(&self, wav: &Path) -> Result<Transcription, SttError> {
        let bytes = std::fs::read(wav)
            .map_err(|error| SttError::Wav(format!("could not read {}: {error}", wav.display())))?;
        let filename = wav
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("audio.wav")
            .to_string();

        let first = self.request(&bytes, &filename, None)?;
        match decide_language(
            self.language.as_deref(),
            first.language.as_deref(),
            &self.allowed_languages,
        ) {
            LanguageDecision::Accept => Ok(first),
            LanguageDecision::Retry(language) => {
                println!(
                    "stt: detected {} not allowed, retried {language}",
                    first.language.as_deref().unwrap_or("-")
                );
                self.request(&bytes, &filename, Some(&language))
            }
        }
    }

    /// Builds the form fields and performs one request. `override_language` is
    /// set only for the single policy retry; the model, response format and
    /// vocabulary prompt never change between the two attempts.
    fn request(
        &self,
        bytes: &[u8],
        filename: &str,
        override_language: Option<&str>,
    ) -> Result<Transcription, SttError> {
        let mut fields: Vec<(&str, String)> = vec![
            ("model", self.model.clone()),
            ("response_format", RESPONSE_FORMAT.to_string()),
        ];
        let language = override_language
            .map(str::to_string)
            .or_else(|| self.language.clone());
        if let Some(language) = language {
            fields.push(("language", language));
        }
        if let Some(prompt) = &self.prompt {
            fields.push(("prompt", prompt.clone()));
        }
        let body = self.transport.send(
            &fields,
            MultipartFile {
                field: "file",
                filename,
                content_type: "audio/wav",
                bytes,
            },
        )?;
        parse_response(&body)
    }
}

impl Transcriber for GroqTranscriber {
    fn transcribe(&self, wav: &Path) -> Result<Transcription, SttError> {
        // Missing key short-circuits before any file or network work.
        if self.api_key.is_none() {
            return Err(SttError::MissingKey);
        }
        self.run(wav)
    }
}

/// Builds a `multipart/form-data` body. Pure and byte-exact, so the wire shape
/// is pinned by a test rather than trusted to a client library.
pub fn multipart_body(
    boundary: &str,
    fields: &[(&str, String)],
    file: MultipartFile<'_>,
) -> Vec<u8> {
    let mut preamble = String::new();
    for (name, value) in fields {
        preamble.push_str(&format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        ));
    }
    preamble.push_str(&format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
        file.field, file.filename, file.content_type
    ));

    let mut body = preamble.into_bytes();
    body.extend_from_slice(file.bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// A boundary unique enough for one process. The value never needs to be secret;
/// it only has to not occur inside the audio bytes, which the timestamp and
/// counter make overwhelmingly unlikely.
fn boundary() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    format!("polaris-{nanos:032x}{count:08x}")
}

/// The documented `verbose_json` response shape. Extra fields (Groq returns
/// `duration`, `segments`, `x_groq` metadata) are ignored on purpose.
#[derive(Debug, Deserialize)]
struct GroqResponse {
    #[serde(default)]
    text: Option<String>,
    /// Present only for `response_format=verbose_json`; a full language name
    /// such as `"Turkish"` or `"English"`.
    #[serde(default)]
    language: Option<String>,
}

/// Parses the provider's `verbose_json` response.
///
/// A 2xx with no `text`, or with blank text, is not a usable transcript: the
/// former is a contract drift ([`SttError::Malformed`]), the latter is the
/// provider telling us it heard nothing ([`SttError::Silent`]). The detected
/// language is normalised to a BCP-47 tag; a missing or unrecognised language
/// is `None` (unknown), never a guess.
pub fn parse_response(body: &str) -> Result<Transcription, SttError> {
    let parsed: GroqResponse = serde_json::from_str(body).map_err(|error| {
        SttError::Malformed(format!("the body was not valid JSON: {error}"))
    })?;
    let text = parsed
        .text
        .ok_or_else(|| SttError::Malformed("the response had no `text` field".to_string()))?
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(SttError::Silent);
    }
    let language = parsed
        .language
        .as_deref()
        .and_then(crate::stt::normalize_detected_language);
    Ok(Transcription { text, language })
}

/// Truncates a string to at most `max` characters, appending an ellipsis marker.
fn truncate(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn multipart_body_has_the_exact_wire_shape() {
        let body = multipart_body(
            "BOUNDARY",
            &[
                ("model", "whisper-large-v3-turbo".to_string()),
                ("response_format", RESPONSE_FORMAT.to_string()),
            ],
            MultipartFile {
                field: "file",
                filename: "polaris-1.wav",
                content_type: "audio/wav",
                bytes: &[0x52, 0x49, 0x46, 0x46],
            },
        );
        let body = String::from_utf8(body).unwrap();
        assert_eq!(
            body,
            "--BOUNDARY\r\n\
             Content-Disposition: form-data; name=\"model\"\r\n\r\n\
             whisper-large-v3-turbo\r\n\
             --BOUNDARY\r\n\
             Content-Disposition: form-data; name=\"response_format\"\r\n\r\n\
             verbose_json\r\n\
             --BOUNDARY\r\n\
             Content-Disposition: form-data; name=\"file\"; filename=\"polaris-1.wav\"\r\n\
             Content-Type: audio/wav\r\n\r\n\
             RIFF\r\n--BOUNDARY--\r\n"
        );
    }

    #[test]
    fn multipart_body_keeps_arbitrary_audio_bytes_intact() {
        // Binary that contains CRLF and a `--` sequence must survive verbatim.
        let bytes: Vec<u8> = vec![0, 1, 13, 10, b'-', b'-', 255, 0, 42];
        let body = multipart_body(
            "XYZ",
            &[],
            MultipartFile {
                field: "file",
                filename: "a.wav",
                content_type: "audio/wav",
                bytes: &bytes,
            },
        );
        let start = body
            .windows(bytes.len())
            .position(|window| window == bytes.as_slice())
            .expect("file bytes must appear verbatim in the body");
        // Exactly once, and followed by the closing delimiter.
        assert_eq!(
            body.windows(bytes.len())
                .filter(|window| *window == bytes.as_slice())
                .count(),
            1
        );
        assert_eq!(
            &body[start + bytes.len()..],
            b"\r\n--XYZ--\r\n"
        );
    }

    #[test]
    fn parses_the_documented_response() {
        // A recorded sample payload, `response_format=verbose_json`. The
        // `language` field is the A12 addition and is what makes the downstream
        // reply/voice follow the audio instead of a guess.
        let transcription = parse_response(
            r#"{"text":"send 10 USDC to ada","language":"English","duration":2.4}"#,
        )
        .unwrap();
        assert_eq!(transcription.text, "send 10 USDC to ada");
        assert_eq!(transcription.language.as_deref(), Some("en"));
    }

    #[test]
    fn the_detected_language_name_is_normalized_to_a_tag() {
        for (reported, expected) in [("Turkish", "tr"), ("English", "en"), ("en-US", "en-us")] {
            let body = format!(r#"{{"text":"merhaba","language":"{reported}"}}"#);
            assert_eq!(
                parse_response(&body).unwrap().language.as_deref(),
                Some(expected),
                "{reported}"
            );
        }
        // An unmapped name is unknown rather than a wrong voice selection.
        assert_eq!(
            parse_response(r#"{"text":"hello","language":"Klingon"}"#)
                .unwrap()
                .language,
            None
        );
    }

    #[test]
    fn parses_turkish_and_trims_surrounding_whitespace() {
        let transcription =
            parse_response(r#"{"text":"  ADA'ya 10 USDC gönder  "}"#).unwrap();
        assert_eq!(transcription.text, "ADA'ya 10 USDC gönder");
        // A plain (non-verbose) body has no language: unknown, not guessed.
        assert_eq!(transcription.language, None);
    }

    #[test]
    fn ignores_extra_fields_such_as_x_groq() {
        let transcription = parse_response(
            r#"{"text":"hello","x_groq":{"id":"req_1","model":"whisper-large-v3-turbo"}}"#,
        )
        .unwrap();
        assert_eq!(transcription.text, "hello");
    }

    #[test]
    fn blank_text_is_reported_as_silence() {
        assert_eq!(parse_response(r#"{"text":"   "}"#), Err(SttError::Silent));
        assert_eq!(parse_response(r#"{"text":""}"#), Err(SttError::Silent));
    }

    #[test]
    fn malformed_bodies_are_rejected() {
        assert!(matches!(
            parse_response("not json"),
            Err(SttError::Malformed(_))
        ));
        assert!(matches!(
            parse_response(r#"{"error":"nope"}"#),
            Err(SttError::Malformed(_))
        ));
    }

    #[test]
    fn a_missing_key_fails_before_any_io() {
        let transcriber = GroqTranscriber::new(None, DEFAULT_MODEL.to_string(), None);
        assert!(!transcriber.has_key());
        // The path does not exist; if the key check did not short-circuit, this
        // would be a `Wav` error instead of `MissingKey`.
        assert_eq!(
            transcriber.transcribe(Path::new("/nonexistent/polaris.wav")),
            Err(SttError::MissingKey)
        );
    }

    #[test]
    fn error_bodies_are_truncated() {
        let long = "x".repeat(MAX_ERROR_BODY + 50);
        let truncated = truncate(&long, MAX_ERROR_BODY);
        assert_eq!(truncated.chars().count(), MAX_ERROR_BODY + 1);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn boundaries_are_unique_across_calls() {
        assert_ne!(boundary(), boundary());
    }

    /// A transport that answers from a script and records the fields it was
    /// asked with, so the retry flow is exercised with no network.
    struct ScriptedTransport {
        responses: std::sync::Mutex<std::collections::VecDeque<Result<String, SttError>>>,
        requests: std::sync::Mutex<Vec<Vec<(String, String)>>>,
    }

    impl ScriptedTransport {
        fn returning(responses: Vec<&str>) -> Self {
            Self {
                responses: std::sync::Mutex::new(
                    responses.into_iter().map(|body| Ok(body.to_string())).collect(),
                ),
                requests: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn requests(&self) -> Vec<Vec<(String, String)>> {
            self.requests.lock().unwrap().clone()
        }
    }

    impl GroqTransport for ScriptedTransport {
        fn send(
            &self,
            fields: &[(&str, String)],
            _file: MultipartFile<'_>,
        ) -> Result<String, SttError> {
            self.requests
                .lock()
                .unwrap()
                .push(fields.iter().map(|(key, value)| (key.to_string(), value.clone())).collect());
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("the scripted transport ran out of responses")
        }
    }

    fn write_valid_wav(label: &str) -> (PathBuf, PathBuf) {
        let dir = crate::env::temp_dir(label);
        let wav = dir.join("clip.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&wav, spec).unwrap();
        for frame in 0..16_000 {
            writer
                .write_sample(if frame % 2 == 0 { 8_000i16 } else { -8_000i16 })
                .unwrap();
        }
        writer.finalize().unwrap();
        (dir, wav)
    }

    fn field<'a>(request: &'a [(String, String)], name: &str) -> Option<&'a str> {
        request
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn a_disallowed_detection_re_runs_once_with_the_first_allowed_language() {
        // First attempt: the owner's Russian mis-detection. Retry: Turkish.
        let transport = Arc::new(ScriptedTransport::returning(vec![
            r#"{"text":"Вот, и киев.","language":"Russian"}"#,
            r#"{"text":"acc1'den acc2'ye 10 XLM gönder","language":"Turkish"}"#,
        ]));
        let transcriber = GroqTranscriber::with_transport(
            transport.clone(),
            None,
            Some("vocab".to_string()),
            parse_allowed_languages(None),
        );
        let (dir, wav) = write_valid_wav("groq-retry");

        let transcription = transcriber.transcribe(&wav).unwrap();
        assert_eq!(transcription.text, "acc1'den acc2'ye 10 XLM gönder");
        let requests = transport.requests();
        assert_eq!(requests.len(), 2, "exactly one retry");
        assert_eq!(field(&requests[0], "language"), None, "first pass auto-detects");
        assert_eq!(field(&requests[1], "language"), Some("tr"), "retry is forced tr");
        // The vocabulary prompt must ride on both attempts.
        assert_eq!(field(&requests[0], "prompt"), Some("vocab"));
        assert_eq!(field(&requests[1], "prompt"), Some("vocab"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_allowed_detection_is_used_without_a_retry() {
        let transport = Arc::new(ScriptedTransport::returning(vec![
            r#"{"text":"send 10 XLM to acc2","language":"English"}"#,
        ]));
        let transcriber = GroqTranscriber::with_transport(
            transport.clone(),
            None,
            None,
            parse_allowed_languages(None),
        );
        let (dir, wav) = write_valid_wav("groq-allowed");

        let transcription = transcriber.transcribe(&wav).unwrap();
        assert_eq!(transcription.text, "send 10 XLM to acc2");
        assert_eq!(transport.requests().len(), 1);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_forced_language_is_sent_and_never_retried() {
        let transport = Arc::new(ScriptedTransport::returning(vec![
            r#"{"text":"merhaba","language":"Russian"}"#,
        ]));
        let transcriber = GroqTranscriber::with_transport(
            transport.clone(),
            Some("de".to_string()),
            None,
            parse_allowed_languages(None),
        );
        let (dir, wav) = write_valid_wav("groq-forced");

        let transcription = transcriber.transcribe(&wav).unwrap();
        assert_eq!(transcription.text, "merhaba");
        let requests = transport.requests();
        assert_eq!(requests.len(), 1, "a forced language is never retried");
        assert_eq!(field(&requests[0], "language"), Some("de"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_retry_never_loops_even_if_the_second_detection_is_also_disallowed() {
        let transport = Arc::new(ScriptedTransport::returning(vec![
            r#"{"text":"Вот, и киев.","language":"Russian"}"#,
            r#"{"text":"still russian","language":"Russian"}"#,
        ]));
        let transcriber = GroqTranscriber::with_transport(
            transport.clone(),
            None,
            None,
            parse_allowed_languages(None),
        );
        let (dir, wav) = write_valid_wav("groq-noloop");

        let transcription = transcriber.transcribe(&wav).unwrap();
        assert_eq!(transcription.text, "still russian");
        assert_eq!(transport.requests().len(), 2, "at most one retry");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
