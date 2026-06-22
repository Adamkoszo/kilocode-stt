import type { SpeechToTextResult } from "./transcribe"

const URL = "http://127.0.0.1:15557/transcribe"

export async function transcribeLocal(
  data: string,
  language: string | undefined,
  _modelId: string,
  signal?: AbortSignal,
): Promise<SpeechToTextResult> {
  try {
    const timeout = AbortSignal.timeout(5 * 60_000) // 5 minute timeout
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout

    const res = await fetch(URL, {
      method: "POST",
      signal: sig,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, language: "hu" }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown error")
      return fail(undefined, `Whisper server error (${res.status}): ${err}`)
    }

    const body = await res.json()
    const text = typeof body?.text === "string" ? body.text.trim() : ""
    if (!text) return fail("empty_transcript", "No speech was detected")

    return { ok: true, text }
  } catch (err: unknown) {
    if (signal?.aborted) return fail("cancelled", "Transcription cancelled")
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("refused") || msg.includes("not available")) {
      return fail("not_available", "Local Whisper server not running. Start with: python 02_scripts/helpers/whisper_server.py")
    }
    return fail(undefined, `Local Whisper failed: ${msg}`)
  }
}

function fail(code: string | undefined, error: string): SpeechToTextResult {
  return { ok: false, error, ...(code ? { code } : {}) }
}
