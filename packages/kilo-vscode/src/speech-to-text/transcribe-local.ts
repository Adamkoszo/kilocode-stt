import { spawn } from "../util/process"
import * as path from "path"
import type { SpeechToTextResult } from "./transcribe"

const PORT = "15557"
const URL = `http://127.0.0.1:${PORT}/transcribe`
const HEALTH = `http://127.0.0.1:${PORT}/health`
const HEALTH_GRACE = 3000 // 3s for server to start responding

let didWarn = false

async function ensureServer(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(HEALTH, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

async function startServer(cwd?: string): Promise<boolean> {
  // Use the workspace directory if available, otherwise try __dirname resolution
  let root = cwd
  if (!root || !root.trim()) {
    root = path.resolve(__dirname, "..", "..", "..", "..")
  }
  
  // Try to start the server
  try {
    const proc = spawn("python", [
      "02_scripts/helpers/whisper_server.py",
      "--port", PORT,
    ], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    })
    proc.unref()

    // Wait for server to become healthy
    await new Promise<void>((resolve, reject) => {
      const start = Date.now()
      const maxWait = 120_000 // 2 minutes max (model download on first run)
      const iv = setInterval(async () => {
        const healthy = await ensureServer()
        if (healthy) {
          clearInterval(iv)
          resolve()
        } else if (Date.now() - start > maxWait) {
          clearInterval(iv)
          reject(new Error("Server start timed out"))
        }
      }, 3000)
    })
    return true
  } catch {
    return false
  }
}

export async function transcribeLocal(
  data: string,
  language: string | undefined,
  _modelId: string,
  dir?: string,
  signal?: AbortSignal,
): Promise<SpeechToTextResult> {
  // Pre-flight: health check, auto-start if needed
  if (!(await ensureServer())) {
    if (!didWarn) {
      console.log("[Kilo STT] Whisper server not running, attempting auto-start...")
      didWarn = true
    }
    const started = await startServer(dir)
    if (!started) {
      return fail(
        "not_available",
        "Whisper server not running and auto-start failed. Start manually:\n  python 02_scripts/helpers/whisper_server.py"
      )
    }
  }

  try {
    const timeout = AbortSignal.timeout(60_000)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout

    const res = await fetch(URL, {
      method: "POST",
      signal: sig,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, language: language || "auto" }),
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
    return fail(undefined, `Local Whisper failed: ${msg}`)
  }
}

function fail(code: string | undefined, error: string): SpeechToTextResult {
  return { ok: false, error, ...(code ? { code } : {}) }
}
