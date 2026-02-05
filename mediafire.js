import axios from "axios"
import fs from "fs"
import path from "path"
import os from "os"
import { pipeline } from "stream/promises"
import Stream from "stream"

const { Transform } = Stream

// Permanent base media directory and mediafire folder (per request)
const BASE_MEDIA_DIR = path.join(path.sep, "HASYIM56")
const MEDIAFIRE_FOLDER = path.join(BASE_MEDIA_DIR, "mediafire")

// Ensure permanent mediafire folder exists
try {
  if (!fs.existsSync(BASE_MEDIA_DIR)) {
    fs.mkdirSync(BASE_MEDIA_DIR, { recursive: true })
  }
  if (!fs.existsSync(MEDIAFIRE_FOLDER)) {
    fs.mkdirSync(MEDIAFIRE_FOLDER, { recursive: true })
  }
} catch (e) {
  // best-effort; keep existing behavior if creation fails
  console.warn("[mediafire] Failed to ensure permanent media folders:", e?.message || e)
}

const DEFAULT_MAX_DOWNLOAD_SIZE = 150 * 1024 * 1024 // 150MB

const safeFilenameFromDisposition = (disp) => {
  if (!disp) return null
  try {
    const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i.exec(disp)
    if (m && m[1]) {
      // Replace + with space (in some headers) and decode percent-encoding
      const maybe = m[1].replace(/\+/g, " ")
      return decodeURIComponent(maybe)
    }
  } catch (e) {
    // ignore
  }
  return null
}

const sanitizeFilename = (name) => {
  if (!name) return "file"
  // Replace + with space, decode URI-encoded parts if any
  let filename = String(name).replace(/\+/g, " ")
  try {
    filename = decodeURIComponent(filename)
  } catch {
    // ignore decode error, keep original
  }
  // Remove path separators and illegal chars for most filesystems
  filename = filename.replace(/[/\\?%*:|"<>]/g, "-")
  // Trim and limit length
  filename = filename.trim()
  if (filename.length > 180) filename = filename.slice(0, 180)
  if (filename === "") filename = "file"
  return filename
}

const extractDirectLinksFromHtml = (html) => {
  const found = new Set()
  const urlRegex = /https?:\/\/download[0-9]*\.mediafire\.com\/[^\s"'<>]+/gi
  let m
  while ((m = urlRegex.exec(html)) !== null) found.add(m[0])
  const altRegex = /https?:\/\/(?:www\.)?mediafire\.com\/download\/[^\s"'<>]+/gi
  while ((m = altRegex.exec(html)) !== null) found.add(m[0])
  const hrefRegex = /href=["'](https?:\/\/download[0-9]*\.mediafire\.com\/[^"']+)["']/gi
  while ((m = hrefRegex.exec(html)) !== null) found.add(m[1])
  return Array.from(found)
}

const tryParseKNO = (html) => {
  try {
    const knoMatch = /kNO\s*=\s*(\{[\s\S]*?\});/i.exec(html) || /kNo\s*=\s*(\{[\s\S]*?\});/i.exec(html)
    if (knoMatch && knoMatch[1]) {
      let jsonText = knoMatch[1]
      jsonText = jsonText.replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":')
      jsonText = jsonText.replace(/,\s*}/g, "}")
      const obj = JSON.parse(jsonText)
      if (obj.download_link) return obj.download_link
      if (obj.direct_download) return obj.direct_download
      if (obj.download_url) return obj.download_url
    }
  } catch (e) {
    // ignore parse errors
  }
  return null
}

const tryGetDirectLink = async (url) => {
  const res = await axios.get(url, { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } })
  const html = res.data
  const fromKno = tryParseKNO(html)
  if (fromKno) return fromKno
  const links = extractDirectLinksFromHtml(html)
  if (links.length > 0) return links[0]
  const jsonRegex = /"download_link"\s*:\s*"([^"]+)"/i
  const jm = jsonRegex.exec(html)
  if (jm && jm[1]) return jm[1]
  const scriptRegex = /https?:\/\/download[0-9]*\.mediafire\.com\/[^\s"'<>]+/i
  const sm = scriptRegex.exec(html)
  if (sm) return sm[0]
  return null
}

/**
 * downloadToFile
 * - Enhanced: accepts an optional progress callback (progressCb(written, total))
 * - Existing behavior preserved; addition is non-destructive.
 */
const downloadToFile = async (url, destPath, maxSize = DEFAULT_MAX_DOWNLOAD_SIZE, progressCb = null) => {
  // Create part file path for atomic behavior
  const partPath = `${destPath}.part`

  // Ensure parent dir exists
  const dir = path.dirname(destPath)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}

  const resp = await axios.get(url, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 10,
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" },
    validateStatus: null,
  })

  const contentLength = Number(resp.headers["content-length"] || 0)
  const contentType = resp.headers["content-type"] || "application/octet-stream"
  const disposition = resp.headers["content-disposition"] || ""
  const filenameFromDisp = safeFilenameFromDisposition(disposition)

  if (contentLength && contentLength > maxSize) {
    resp.data.destroy()
    const err = new Error(`File terlalu besar (${(contentLength / 1024 / 1024).toFixed(2)} MB). Batas: ${(maxSize / 1024 / 1024).toFixed(2)} MB`)
    err.code = "FILE_TOO_LARGE"
    throw err
  }

  let written = 0
  const counter = new Transform({
    transform(chunk, enc, cb) {
      written += chunk.length
      // Call progress callback synchronously; consumer should be resilient to high-frequency updates.
      try {
        if (typeof progressCb === "function") {
          try {
            progressCb(written, contentLength || 0)
          } catch (e) {
            // ensure transform does not throw because of callback
          }
        }
      } catch (e) {}
      if (written > maxSize) {
        cb(new Error("DOWNLOAD_EXCEEDED_MAX_SIZE"))
        return
      }
      cb(null, chunk)
    },
  })

  // Pipeline -> write to .part then rename
  try {
    await pipeline(resp.data, counter, fs.createWriteStream(partPath))

    // If final file already exists (some streams might write directly), skip rename
    if (fs.existsSync(destPath)) {
      return {
        size: contentLength || written,
        mime: contentType,
        filename: filenameFromDisp || path.basename(destPath),
      }
    }

    // If part file is missing for any reason, attempt robust fallback search
    if (!fs.existsSync(partPath)) {
      // Look for candidate temp files in the same dir created by mediafire flow (prefix mediafire_)
      try {
        const files = fs.readdirSync(dir)
        const candidates = files
          .filter((f) => /^mediafire_\d+_[a-z0-9]+/i.test(f))
          .map((f) => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        if (candidates.length > 0) {
          // pick the most recently modified candidate
          candidates.sort((a, b) => b.mtime - a.mtime)
          const chosen = candidates[0].full
          try {
            // Attempt to move/rename chosen -> destPath
            try {
              fs.renameSync(chosen, destPath)
            } catch (e) {
              // fallback to copy+unlink for cross-device or other rename issues
              const data = fs.readFileSync(chosen)
              fs.writeFileSync(destPath, data)
              try { fs.unlinkSync(chosen) } catch {}
            }
            return {
              size: contentLength || written,
              mime: contentType,
              filename: filenameFromDisp || path.basename(destPath),
            }
          } catch (innerErr) {
            // if fallback failed, provide verbose message below
            console.warn("[downloadToFile] Fallback move failed:", innerErr?.message || innerErr)
          }
        }
      } catch (e) {
        // ignore candidate discovery errors, will fall through to final error
        console.warn("[downloadToFile] Candidate discovery error:", e?.message || e)
      }

      // If we reach here, part file genuinely missing and no fallback succeeded
      const folderList = (() => {
        try {
          return fs.readdirSync(dir).slice(0, 50) // limit listing to first 50 for safety
        } catch {
          return []
        }
      })()
      const err = new Error(
        `Part file tidak ditemukan setelah download. Tidak dapat merename '${partPath}' -> '${destPath}'. ` +
        `Daftar berkas pada folder '${dir}': [${folderList.join(", ")}].`
      )
      err.code = "PART_MISSING"
      throw err
    }

    // Attempt rename with cross-device fallback
    try {
      fs.renameSync(partPath, destPath)
    } catch (renameErr) {
      // If rename fails (EXDEV or other), try copy+unlink
      try {
        const data = fs.readFileSync(partPath)
        fs.writeFileSync(destPath, data)
        try { fs.unlinkSync(partPath) } catch {}
      } catch (fallbackErr) {
        // Ensure partial cleaned up and rethrow original rename error
        try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch {}
        throw renameErr
      }
    }
  } catch (e) {
    // Ensure partial file cleaned up
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch {}
    throw e
  }

  return {
    size: contentLength || written,
    mime: contentType,
    filename: filenameFromDisp || path.basename(destPath),
  }
}

export default async function registerMediafire(sock, options = {}) {
  const {
    getAccessMode = () => "public",
    isUserOwner = () => false,
    normalizeNumber = (n) => String(n),
    OWNER_NUMBER = "",
    TEMP_FOLDER = MEDIAFIRE_FOLDER,
    MAX_DOWNLOAD_SIZE = DEFAULT_MAX_DOWNLOAD_SIZE,
  } = options

  if (!fs.existsSync(TEMP_FOLDER)) {
    try { fs.mkdirSync(TEMP_FOLDER, { recursive: true }) } catch (e) {}
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return
      const msg = messages && messages[0]
      if (!msg || !msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from && from.endsWith && from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = String(sender || "").split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isFromBot = msg.key.fromMe === true
      if (getAccessMode() === "private" && !isMainOwner && !isFromBot) return

      const messageType = Object.keys(msg.message)[0]
      const text =
        messageType === "conversation"
          ? msg.message.conversation
          : messageType === "extendedTextMessage"
            ? msg.message.extendedTextMessage.text
            : messageType === "imageMessage"
              ? msg.message.imageMessage.caption
              : ""

      if (!text) return
      const args = text.trim().split(" ")
      const cmd = args[0].toLowerCase()
      if (cmd !== ".mediafire") return

      // Restrict .mediafire to private chat only to avoid large uploads in groups and improve UX
      if (isGroup) {
        await sock.sendMessage(from, { text: "Perintah .mediafire hanya bisa digunakan di chat pribadi. Silakan hubungi bot melalui chat pribadi untuk mengunduh file." }, { quoted: msg })
        return
      }

      if (args.length < 2) {
        await sock.sendMessage(from, { text: "Format: .mediafire <link_mediafire>\nContoh: .mediafire https://www.mediafire.com/file/xxxx/namafile" }, { quoted: msg })
        return
      }

      const mfUrl = args[1].trim()
      await sock.sendMessage(from, { text: "⏳ Sedang memproses tautan MediaFire..." }, { quoted: msg })

      let directLink = null
      let filenameCandidate = null
      let contentType = "application/octet-stream"

      // Try mediafire npm lib dynamically (if installed)
      try {
        const mfLib = await import("mediafire").catch(() => null)
        if (mfLib && mfLib.default) {
          try {
            const MF = mfLib.default
            let client
            try { client = new MF() } catch { client = MF }
            if (typeof client.getInfo === "function") {
              const info = await client.getInfo(mfUrl)
              if (info && (info.direct_link || info.link)) {
                directLink = info.direct_link || info.link
                filenameCandidate = info.filename || filenameCandidate
              }
            }
            if (!directLink && typeof client.getDirectLink === "function") {
              const info = await client.getDirectLink(mfUrl)
              if (info && (info.link || info.direct_link)) directLink = info.link || info.direct_link
            }
          } catch (libErr) {
            console.warn("[mediafire] mediafire lib parsed failed, fallback to scraping:", libErr?.message || libErr)
          }
        }
      } catch (e) {
        // ignore dynamic import errors
      }

      if (!directLink) {
        try {
          directLink = await tryGetDirectLink(mfUrl)
        } catch (e) {
          console.error("[mediafire] tryGetDirectLink error:", e?.message || e)
        }
      }

      if (!directLink) {
        await sock.sendMessage(from, { text: "❌ Gagal menemukan tautan unduh langsung dari MediaFire. Pastikan tautan benar, file publik, dan tidak memerlukan login/captcha." }, { quoted: msg })
        return
      }

      const timestamp = Date.now()
      const randomSuffix = Math.random().toString(36).slice(2, 8)
      const tempFileBase = path.join(TEMP_FOLDER, `mediafire_${timestamp}_${randomSuffix}`)

      // Progress UI variables (same-message edits, professional and non-spammy)
      let progressMsg = null
      let lastProgressSentAt = 0
      const PROGRESS_THROTTLE_MS = 900
      let lastProgressText = ""
      let latestProgressState = { written: 0, total: 0, updatedAt: Date.now() }

      // Helper: build progress text for edits
      const buildProgressText = ({ written, total }) => {
        try {
          const header = "⬇️ Mengunduh dari MediaFire"
          const totalKnown = total && total > 0
          const pct = totalKnown ? Math.min(100, Math.round((written / total) * 100)) : 0
          const BAR_LEN = 20
          const filled = totalKnown ? Math.max(0, Math.min(BAR_LEN, Math.round((pct / 100) * BAR_LEN))) : 0
          const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled)
          const humanWritten = (written / 1024 / 1024).toFixed(2) + " MB"
          const humanTotal = totalKnown ? (total / 1024 / 1024).toFixed(2) + " MB" : "Unknown"
          const lines = []
          lines.push(header)
          lines.push("")
          if (totalKnown) {
            lines.push(`${bar} ${pct}%`)
            lines.push(`📦 ${humanWritten} / ${humanTotal}`)
          } else {
            // unknown total
            lines.push(`${bar} ${humanWritten}`)
            lines.push(`📦 ${humanWritten} / ${humanTotal}`)
          }
          lines.push("")
          lines.push("Tunggu sebentar — file akan dikirim setelah selesai.")
          return lines.join("\n")
        } catch (e) {
          return "⏳ Mengunduh..."
        }
      }

      // progress callback used by downloadToFile (it will be called frequently)
      const progressCallback = (written, total) => {
        latestProgressState = { written: Number(written || 0), total: Number(total || 0), updatedAt: Date.now() }
      }

      // Interval to send/edit the single progress message at throttled rate
      const progressInterval = setInterval(async () => {
        try {
          const now = Date.now()
          // Only update when enough time passed
          if (now - lastProgressSentAt < PROGRESS_THROTTLE_MS) return
          // Compose display
          const display = buildProgressText(latestProgressState)
          if (display === lastProgressText && progressMsg) {
            lastProgressSentAt = now
            return
          }
          lastProgressText = display
          lastProgressSentAt = now
          try {
            if (!progressMsg) {
              progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
            } else {
              await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
            }
          } catch (e) {
            // non-fatal - continue download even if we cannot edit message
            console.warn("[mediafire PROGRESS] Failed to send/edit progress (silent):", e?.message || e)
          }
        } catch (e) {
          // swallow
        }
      }, 700)

      try {
        await sock.sendMessage(from, { text: "⬇️ Mengunduh file dari MediaFire — memulai proses..." }, { quoted: msg })

        // Guess filename and sanitize it
        const guessedRaw = filenameCandidate || path.basename(directLink.split("?")[0]) || `mediafire_${timestamp}`
        const guessedName = sanitizeFilename(guessedRaw)
        const finalTempPath = `${tempFileBase}_${guessedName}`

        // Call download with progress callback (non-destructive addition)
        const meta = await downloadToFile(directLink, finalTempPath, MAX_DOWNLOAD_SIZE, progressCallback)
        contentType = meta.mime || contentType

        // Final progress update (100% or done)
        latestProgressState = { written: meta.size || 0, total: meta.size || 0, updatedAt: Date.now() }
        // Make sure final text appears quickly
        try {
          const finalDisplay = buildProgressText(latestProgressState)
          if (!progressMsg) {
            progressMsg = await sock.sendMessage(from, { text: finalDisplay }, { quoted: msg })
          } else {
            await sock.sendMessage(from, { text: finalDisplay }, { edit: progressMsg.key })
          }
        } catch (e) {
          console.warn("[mediafire PROGRESS] final edit failed (silent):", e?.message || e)
        }

        // Verify file exists before reading
        let exists = false
        try {
          await fs.promises.access(finalTempPath, fs.constants.R_OK)
          exists = true
        } catch {
          exists = false
        }

        if (!exists) {
          await sock.sendMessage(from, { text: "❌ Terjadi kesalahan: file yang diunduh tidak ditemukan setelah proses download." }, { quoted: msg })
          console.error(`[mediafire] Expected file missing after download: ${finalTempPath}`)
          return
        }

        // Read and send (keamanan: file dibaca sepenuhnya; file besar mungkin memakan memori)
        const fileBuffer = await fs.promises.readFile(finalTempPath)
        await sock.sendMessage(from, {
          document: fileBuffer,
          mimetype: contentType,
          fileName: guessedName,
        }, { quoted: msg })

        await sock.sendMessage(from, { text: `✅ Selesai mengirim: ${guessedName}` }, { quoted: msg })
      } catch (err) {
        console.error("[mediafire] Download/Send error:", err?.message || err)
        let errMsg = "Gagal mengunduh atau mengirim file MediaFire."
        if (err.code === "FILE_TOO_LARGE" || (err?.message || "").includes("DOWNLOAD_EXCEEDED_MAX_SIZE")) {
          errMsg = "File terlalu besar untuk diunduh lewat bot."
        }
        if (err.code === "PART_MISSING") {
          // Provide a friendlier, actionable message for this specific case
          errMsg = "Terjadi masalah saat menyusun file sementara (.part) selama proses download. Coba lagi nanti atau cek hak akses filesystem."
        }
        await sock.sendMessage(from, { text: `❌ ${errMsg}\n${err?.message || ""}` }, { quoted: msg })
      } finally {
        // cleanup temp files created for mediafire (both .part and final)
        try {
          const files = fs.readdirSync(TEMP_FOLDER)
          files.forEach((f) => {
            if (f.startsWith("mediafire_")) {
              const p = path.join(TEMP_FOLDER, f)
              try { fs.unlinkSync(p) } catch {}
            }
          })
        } catch (cleanupErr) {
          // ignore cleanup errors
        }

        // Stop progress updater
        try { clearInterval(progressInterval) } catch {}
        // Try to finalize progress message if present
        try {
          if (progressMsg) {
            await sock.sendMessage(from, { text: "✅ Proses download MediaFire selesai." }, { edit: progressMsg.key })
          }
        } catch (e) {
          // non-fatal
        }
      }
    } catch (outerErr) {
      console.error("[mediafire] Handler outer error:", outerErr?.message || outerErr)
    }
  })
}