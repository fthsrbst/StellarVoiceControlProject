// F3 live STT probe — how Groq transcribes our commands with and without the
// vocabulary prompt, auto-detected vs forced Turkish.
//
//   npm run stt:probe
//
// It is deliberately opt-in (real Groq calls) and never part of `npm test`. It
// synthesises six spoken samples with macOS `say`, converts them to the 16 kHz
// mono WAV the Rust backend sends with `afconvert`, and posts them with the
// SAME fields `app/src-tauri/src/stt/groq.rs` uses. The key is read through
// `--env-file` at the repo root and is never printed, logged or written. The
// generated audio is removed on exit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.POLARIS_STT_MODEL || "whisper-large-v3-turbo";

// Mirrors `stt::DEFAULT_PROMPT`; aliases from POLARIS_ALIASES are appended the
// same way `stt::build_prompt` does.
const DEFAULT_PROMPT =
  "Voice commands for a Stellar wallet. Examples: \"acc1'den acc2'ye 10 XLM gönder\", " +
  "\"Send 10 XLM to acc2\", \"bakiyem ne kadar\", \"iptal et\". Terms: XLM, USDC, TRY, " +
  "Stellar, cüzdan, hesap, gönder, yolla, yatır, çek, iptal, zamanlanmış ödeme, limit, bakiye.";

const SAMPLES = [
  { name: "tr-acc1-acc2", voice: "Yelda", text: "acc1'den acc2'ye on XLM gönder" },
  { name: "tr-hesap", voice: "Yelda", text: "iki numaralı hesaba on XLM yolla" },
  { name: "tr-bakiye", voice: "Yelda", text: "bakiyem ne kadar" },
  { name: "tr-iptal", voice: "Yelda", text: "zamanlanmış ödeme limitini iptal et" },
  { name: "en-acc2", voice: "Samantha", text: "Send ten XLM to acc2" },
  { name: "en-acc1-acc2", voice: "Samantha", text: "send ten XLM from acc1 to acc2" },
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
const prompt = aliases.length
  ? `${DEFAULT_PROMPT} Recipients: ${aliases.join(", ")}.`
  : DEFAULT_PROMPT;

const VARIANTS = [
  { name: "auto", language: null, prompt: null },
  { name: "auto+prompt", language: null, prompt },
  { name: "forced-tr", language: "tr", prompt: null },
  { name: "forced-tr+prompt", language: "tr", prompt },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const columns = ["sample", "variant", "detected", "text"];
  const cells = rows.map((row) => [
    row.sample,
    row.variant,
    row.language ?? "-",
    (row.text ?? "").replace(/\s+/g, " ").slice(0, 52),
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
  for (const sample of SAMPLES) {
    const aiff = join(dir, `${sample.name}.aiff`);
    const wav = join(dir, `${sample.name}.wav`);
    execFileSync("say", ["-v", sample.voice, "-o", aiff, sample.text]);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
    sample.wav = wav;
  }

  const started = Date.now();
  const rows = [];
  for (const sample of SAMPLES) {
    for (const variant of VARIANTS) {
      process.stderr.write(`stt-probe: ${sample.name} / ${variant.name}\n`);
      const result = await transcribe(sample.wav, variant);
      rows.push({ sample: sample.name, variant: variant.name, ...result });
      await sleep(400);
    }
  }
  console.log(`model=${MODEL} requests=${rows.length} in ${Date.now() - started} ms\n`);
  printTable(rows);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
