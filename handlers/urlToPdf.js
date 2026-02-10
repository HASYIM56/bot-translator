import fs from "fs"
import path from "path"
import os from "os"
import fetch from "node-fetch" // node-fetch included in package.json for compatibility

const DEFAULT_API = "https://h56-pdf-tools-api.netlify.app/api/url-to-pdf"
const DEFAULT_MAX_UPLOAD = 100 * 1024 * 1024 // 100MB

const ensureFolder = (p) => {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  } catch (e) {
  }
}

const isValidUrl = (s) => {
  try {
    if (!s || typeof s !== "string") return false
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch (e) {
    return false
  }
}

const parseKeyValueOptions = (tokens = []) => {
  const opts = {}
  for (const t of tokens) {
    if (!t) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim().toLowerCase()
    const v = t.slice(eq + 1).trim()
    if (!k) continue
    opts[k] = v
  }
  return opts
}

export default async function urlToPdfHandler(sock, msg, rawArgs, opts = {}) {
  const {
    API_ENDPOINT = DEFAULT_API,
    TEMP_FOLDER = path.join(os.tmpdir(), "h56-urltopdf"),
    MAX_UPLOAD_SIZE = DEFAULT_MAX_UPLOAD,
    encodeUnicodeText = (t) => (typeof t === "string" ? t : String(t)),
    getAccessMode = () => "public",
    isUserOwner = () => false,
    normalizeNumber = (n) => (n || "").toString().replace(/\D/g, ""),
    OWNER_NUMBER = "",
    logger = console,
    timeoutMs = 30_000,
  } = opts

  try {
    // early checks
    if (!msg || !msg.key) return
    const from = msg.key.remoteJid
    if (!from) return

    // Access mode check (respect private)
    try {
      const senderRaw = (from.endsWith?.("@g.us") ? (msg.key.participant || from) : from) || ""
      const senderNumber = String(senderRaw).split("@")[0]
      if (getAccessMode && getAccessMode() === "private") {
        const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
        const isFromMe = msg.key.fromMe === true
        if (!isMainOwner && !isFromMe) return // silently ignore in private mode like other handlers
      }
    } catch (e) {
      // continue if access check fails
    }

    const raw = (typeof rawArgs === "string") ? rawArgs.trim() : (Array.isArray(rawArgs) ? rawArgs.join(" ").trim() : String(rawArgs || "").trim())
    if (!raw) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .urltopdf <url> [filename=nama.pdf] [format=A4|Letter] [landscape=true|false] [margin=top,right,bottom,left(in mm)]\nContoh: .urltopdf https://example.com filename=report.pdf") }, { quoted: msg })
      return
    }

    // Tokenize: first token is URL, the rest optionally key=value
    const parts = raw.split(/\s+/)
    const url = parts[0]
    const kvTokens = parts.slice(1)
    const kv = parseKeyValueOptions(kvTokens)

    if (!isValidUrl(url)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("URL tidak valid. Pastikan diawali http:// atau https://. Contoh: .urltopdf https://example.com") }, { quoted: msg })
      return
    }

    // Build request payload with supported fields
    const filenameCandidate = kv.filename ? kv.filename.replace(/[/\\?%*:|"<>]/g, "-").trim() : null
    const filename = filenameCandidate || `urltopdf_${Date.now()}.pdf`
    const format = kv.format || "A4"
    const landscape = (typeof kv.landscape !== "undefined") ? (String(kv.landscape).toLowerCase() === "true") : false

    let margin = undefined
    if (kv.margin) {
      const partsMargin = kv.margin.split(",").map((p) => Number(String(p).trim())).map((n) => (Number.isFinite(n) ? n : 0))
      if (partsMargin.length === 4) {
        margin = { top: partsMargin[0], right: partsMargin[1], bottom: partsMargin[2], left: partsMargin[3] }
      }
    }

    // Inform user we started
    try {
      await sock.sendMessage(from, { text: encodeUnicodeText(`⏳ Mengonversi URL menjadi PDF — mohon tunggu...\nURL: ${url}`) }, { quoted: msg })
    } catch (_) {}

    // Ensure temp folder exists
    ensureFolder(TEMP_FOLDER)

    // Call API
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), timeoutMs)

    const body = { url, filename, format, landscape }
    if (margin) body.margin = margin

    let res
    try {
      res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(tid)
      const errMsg = (e && e.name === "AbortError") ? "Request timeout saat menghubungi layanan konversi PDF." : `Gagal menghubungi layanan konversi: ${e?.message || e}`
      logger?.warn?.("[URLTOPDF] fetch failed:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ ${errMsg}`) }, { quoted: msg })
      return
    } finally {
      clearTimeout(tid)
    }

    // If non-OK, try to read text/json for helpful message
    if (!res.ok) {
      let text = ""
      try { text = await res.text() } catch (_) { text = `HTTP ${res.status}` }
      logger?.warn?.("[URLTOPDF] API returned non-OK:", res.status, text)
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Layanan konversi mengembalikan error: HTTP ${res.status}\n${text.substring ? text.substring(0, 800) : text}`) }, { quoted: msg })
      return
    }

    const contentType = res.headers.get("content-type") || ""
    // If API returns JSON (error or meta), try to parse and show message
    if (!contentType.toLowerCase().includes("application/pdf") && contentType.toLowerCase().includes("application/json")) {
      try {
        const js = await res.json()
        const m = js && (js.error || js.message || JSON.stringify(js)).toString()
        await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Layanan konversi merespon: ${m}`) }, { quoted: msg })
        return
      } catch (e) {
        // fallthrough to attempt reading text
        const t = await res.text().catch(() => "")
        await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Layanan konversi merespon (non-pdf): ${t.substring ? t.substring(0, 800) : t}`) }, { quoted: msg })
        return
      }
    }

    // Expect PDF bytes
    let arrayBuffer
    try {
      arrayBuffer = await res.arrayBuffer()
    } catch (e) {
      logger?.warn?.("[URLTOPDF] failed reading arrayBuffer:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal membaca hasil konversi dari layanan.") }, { quoted: msg })
      return
    }

    const buffer = Buffer.from(arrayBuffer || Buffer.alloc(0))
    const size = buffer.length || 0

    // Size guard vs MAX_UPLOAD_SIZE
    const maxAllowed = Number(MAX_UPLOAD_SIZE) || DEFAULT_MAX_UPLOAD
    if (size > maxAllowed) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ File PDF terlalu besar untuk dikirim lewat WhatsApp (${(size / 1024 / 1024).toFixed(2)} MB). Batas: ${(maxAllowed / 1024 / 1024).toFixed(2)} MB.`) }, { quoted: msg })
      return
    }

    // Save to temp path (optional) then send
    const safeFilename = filename || `urltopdf_${Date.now()}.pdf`
    const outPath = path.join(TEMP_FOLDER, safeFilename)
    try {
      fs.writeFileSync(outPath, buffer)
    } catch (e) {
      // fallback: still attempt to send from buffer without saving
      logger?.warn?.("[URLTOPDF] failed to save temp file, will send from buffer:", e?.message || e)
    }

    // Send as document
    try {
      await sock.sendMessage(from, {
        document: buffer,
        fileName: safeFilename,
        mimetype: "application/pdf",
      }, { quoted: msg })
      // optional follow-up message
      try { await sock.sendMessage(from, { text: encodeUnicodeText(`✅ Selesai — PDF dikirim: ${safeFilename} • ${(size / 1024 / 1024).toFixed(2)} MB`) }) } catch (_) {}
    } catch (sendErr) {
      logger?.error?.("[URLTOPDF] sendMessage failed:", sendErr?.message || sendErr)
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengirim file PDF. Error: ${sendErr?.message || sendErr}`) }, { quoted: msg })
    } finally {
      // cleanup temp saved file if exists
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath) } catch (e) {}
    }
  } catch (err) {
    logger?.error?.("[URLTOPDF] Handler unexpected error:", err?.message || err)
    try { await sock.sendMessage(msg.key.remoteJid, { text: encodeUnicodeText(`❌ Terjadi kesalahan saat memproses .urltopdf: ${err?.message || err}`) }, { quoted: msg }) } catch (_) {}
  }
}