// F3 live STT probe — how Groq transcribes our commands with the language-aware
// vocabulary prompt, and whether short junk clips echo it back.
//
//   npm run stt:probe
//
// It is deliberately opt-in (real Groq calls) and never part of `npm test`. It
// synthesises spoken samples with macOS `say`, writes short silence/noise/hum
// WAVs with a tiny helper, converts everything to the 16 kHz mono WAV the Rust
// backend sends with `afconvert`, and posts them with the SAME fields
// `app/src-tauri/src/stt/groq.rs` uses. The key is read through `--env-file` at
// the repo root and is never printed, logged or written. Generated audio is
// removed on exit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.POLARIS_STT_MODEL || "whisper-large-v3-turbo";
const SAMPLE_RATE = 16_000;

// Mirror `stt::{DEFAULT_PROMPT_EN, DEFAULT_PROMPT_TR, DEFAULT_PROMPT}` (F3-fix).
const PROMPT_EN = "Send 10 XLM from acc1 to acc2.";
const PROMPT_TR = "acc1'den acc2'ye 10 XLM gönder.";
const PROMPT_BILINGUAL = "Send 10 XLM from acc1 to acc2. acc1'den acc2'ye 10 XLM gönder.";

const SPEECH_SAMPLES = [
  { name: "tr-acc1-acc2", voice: "Yelda", text: "acc1'den acc2'ye on XLM gönder" },
  { name: "tr-hesap", voice: "Yelda", text: "iki numaralı hesaba on XLM yolla" },
  { name: "tr-bakiye", voice: "Yelda", text: "bakiyem ne kadar" },
  { name: "tr-iptal", voice: "Yelda", text: "zamanlanmış ödeme limitini iptal et" },
  { name: "en-acc2", voice: "Samantha", text: "Send ten XLM to acc2" },
  { name: "en-acc1-acc2", voice: "Samantha", text: "send ten XLM from acc1 to acc2" },
];

// Short clips with no speech: the case that made Whisper echo the prompt back.
// All are at or above the 700 ms pre-flight minimum so the app would send them.
const JUNK_SAMPLES = [
  { name: "silence-0.7s", kind: "silence", ms: 700, amplitude: 0 },
  { name: "noise-1.0s", kind: "noise", ms: 1_000, amplitude: 150 },
  { name: "hum-1.5s", kind: "hum", ms: 1_500, amplitude: 2_500 },
];

const key = process.env.GROQ_API_KEY?.trim();
if (!key) {
  console.error("stt-probe: GROQ_API_KEY is not set (run via `npm run stt:probe`).");
  process.exit(2);
}

const aliases = (process.env.POLARIS_ALIASES || "")
  .split(",")
  .map((entry) => entry.split("=")[0].trim())
  .filter(Boolean);

/** Mirrors `stt::join_names`. */
function joinNames(names, conjunction) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

/** Mirrors `stt::build_prompt`: the hint follows the language in use. */
function buildPrompt(language) {
  const base =
    language === "en" ? PROMPT_EN : language === "tr" ? PROMPT_TR : PROMPT_BILINGUAL;
  if (aliases.length === 0) return base;
  const recipients =
    language === "tr"
      ? `Alıcılar ${joinNames(aliases, "ve")}.`
      : `Recipients are ${joinNames(aliases, "and")}.`;
  return `${base} ${recipients}`;
}

const VARIANTS = [
  { name: "auto+prompt", language: null },
  { name: "en+prompt", language: "en" },
  { name: "tr+prompt", language: "tr" },
].map((variant) => ({ ...variant, prompt: buildPrompt(variant.language) }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes a 16-bit PCM mono WAV of silence, low noise or a low hum. */
function writeJunkWav(path, kind, ms, amplitude) {
  const frames = Math.round((SAMPLE_RATE * ms) / 1000);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let state = 12345;
  for (let i = 0; i < frames; i += 1) {
    let sample = 0;
    if (kind === "noise") {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      sample = (state % (2 * amplitude + 1)) - amplitude;
    } else if (kind === "hum") {
      sample = Math.round(amplitude * Math.sin((2 * Math.PI * 90 * i) / SAMPLE_RATE));
    }
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

/** Reads a WAV's duration in ms (scans for the `data` chunk). */
function wavDurationMs(path) {
  const buffer = readFileSync(path);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bits = buffer.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      const frames = size / (channels * (bits / 8));
      return Math.round((frames * 1000) / sampleRate);
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

// Mirror `stt::{is_prompt_echo, language_mismatch}` so the table shows the same
// verdict the Rust filter would reach.
function words(text) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function containsPromptRun(text, prompt) {
  const transcript = words(text).join(" ");
  const source = words(prompt).join(" ");
  const run = 12;
  if (transcript.length < run || source.length < run) return false;
  for (let start = 0; start + run <= source.length; start += 1) {
    if (transcript.includes(source.slice(start, start + run))) return true;
  }
  return false;
}

function isPromptEcho(text, prompt, durationMs) {
  if (!prompt || durationMs >= 3_000) return false;
  const transcript = words(text);
  if (transcript.length === 0) return false;
  if (transcript.some((word) => /^\d/.test(word))) return false;
  if (containsPromptRun(text, prompt)) return true;
  const source = words(prompt);
  if (source.length === 0) return false;
  const echoed = transcript.filter((word) => source.includes(word)).length;
  return echoed * 5 >= transcript.length * 3;
}

function languageMismatch(forced, detected) {
  // Groq reports a name ("Turkish"); the Rust filter normalises it to a code
  // first. Mirror that so the verdict matches `stt::language_mismatch`.
  const codes = { english: "en", turkish: "tr", german: "de", french: "fr", russian: "ru" };
  const code = (value) => {
    if (!value) return null;
    const tag = String(value).trim().toLowerCase().replace(/_/g, "-");
    const base = tag.split("-")[0];
    if (/^[a-z]{2,3}$/.test(base)) return base;
    return codes[base] ?? null;
  };
  const from = code(forced);
  const to = code(detected);
  if (!from || !to) return false;
  return from !== to;
}

function verdict(row) {
  const text = (row.text || "").trim();
  if (!text) return "empty";
  if (languageMismatch(row.language, row.detected)) return "lang-mismatch";
  if (isPromptEcho(text, row.prompt, row.durationMs)) return "prompt-echo";
  return "ok";
}

/** Posts one WAV with the exact fields the Rust Groq backend builds. */
async function transcribe(wavPath, variant) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  if (variant.language) form.append("language", variant.language);
  if (variant.prompt) form.append("prompt", variant.prompt);
  form.append("file", new Blob([readFileSync(wavPath)], { type: "audio/wav" }), "clip.wav");

  // The free tier rate-limits bursts, so pace the requests and back off once on
  // a 429 rather than losing the row.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (response.ok) {
      const json = await response.json();
      return { language: json.language ?? null, text: json.text ?? "" };
    }
    const body = (await response.text()).slice(0, 100).replace(/\s+/g, " ");
    if (response.status !== 429 || attempt === 1) {
      return { language: null, text: `HTTP ${response.status}: ${body}` };
    }
    await sleep(3_000);
  }
}

function printTable(rows) {
  const columns = ["sample", "variant", "detected", "verdict", "text"];
  const cells = rows.map((row) => [
    row.sample,
    row.variant,
    row.detected ?? "-",
    row.verdict,
    (row.text ?? "").replace(/\s+/g, " ").slice(0, 48),
  ]);
  const widths = columns.map((_, index) =>
    Math.max(...cells.map((cell) => cell[index].length), columns[index].length),
  );
  const line = (values) => values.map((value, i) => value.padEnd(widths[i])).join("  ");
  console.log(line(columns));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of cells) console.log(line(row));
}

const dir = mkdtempSync(join(tmpdir(), "polaris-stt-probe-"));
try {
  const samples = [];
  for (const sample of SPEECH_SAMPLES) {
    const aiff = join(dir, `${sample.name}.aiff`);
    const wav = join(dir, `${sample.name}.wav`);
    execFileSync("say", ["-v", sample.voice, "-o", aiff, sample.text]);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
    samples.push({ ...sample, wav });
  }
  for (const sample of JUNK_SAMPLES) {
    const wav = join(dir, `${sample.name}.wav`);
    writeJunkWav(wav, sample.kind, sample.ms, sample.amplitude);
    samples.push({ ...sample, wav });
  }
  for (const sample of samples) {
    sample.durationMs = wavDurationMs(sample.wav);
  }

  const started = Date.now();
  const rows = [];
  for (const sample of samples) {
    for (const variant of VARIANTS) {
      process.stderr.write(`stt-probe: ${sample.name} / ${variant.name}\n`);
      const result = await transcribe(sample.wav, variant);
      const row = {
        sample: sample.name,
        variant: variant.name,
        durationMs: sample.durationMs,
        // The forced language (not the detected one) is what the mismatch check
        // compares against.
        language: variant.language,
        prompt: variant.prompt,
        detected: result.language,
        text: result.text,
      };
      row.verdict = verdict(row);
      rows.push(row);
      await sleep(400);
    }
  }
  console.log(`model=${MODEL} requests=${rows.length} in ${Date.now() - started} ms\n`);
  printTable(rows);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
