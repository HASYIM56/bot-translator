import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

// Get directory name (untuk ESM modules)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Folder struktur untuk menyimpan media
const BASE_SAVE_DIR = path.join(__dirname, "downloads")
const MEDIA_FOLDERS = {
  imageMessage: "images",
  videoMessage: "videos",
  audioMessage: "audios",
  documentMessage: "documents",
  stickerMessage: "stickers",
  unknownMessage: "unknown",
}

// Ensure base downloads folder exists
const ensureDownloadsFolder = () => {
  try {
    if (!fs.existsSync(BASE_SAVE_DIR)) {
      fs.mkdirSync(BASE_SAVE_DIR, { recursive: true })
    }
    // Ensure semua subfolder ada
    Object.values(MEDIA_FOLDERS).forEach((folder) => {
      const folderPath = path.join(BASE_SAVE_DIR, folder)
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
      }
    })
  } catch (e) {
    console.warn("[MEDIA AUTO-SAVE] Failed to ensure downloads folder structure:", e?.message || e)
  }
}

// Helper: normalize pesan untuk handle ephemeralMessage, viewOnceMessage, dll
const normalizeMessage = (msg) => {
  if (!msg) return null
  if (msg.ephemeralMessage?.message) return msg.ephemeralMessage.message
  if (msg.viewOnceMessage?.message) return msg.viewOnceMessage.message
  if (msg.viewOnceMessageV2?.message) return msg.viewOnceMessageV2.message
  if (msg.viewOnceMessageV2Extension?.message) return msg.viewOnceMessageV2Extension.message
  return msg
}

// Helper: deteksi tipe media
const getMediaType = (messageObj) => {
  if (!messageObj) return null
  const messageType = Object.keys(messageObj)[0]
  return messageType || null
}

// Helper: ambil extension dari message atau tipe
const getFileExtension = (messageType, messageObj) => {
  const mediaObj = messageObj?.[messageType]

  switch (messageType) {
    case "imageMessage":
      return mediaObj?.mimetype?.includes("webp") ? ".webp" : ".jpg"
    case "videoMessage":
      return ".mp4"
    case "audioMessage":
      // Voice note atau audio file
      return mediaObj?.mimetype?.includes("ogg") || mediaObj?.ptt ? ".ogg" : ".m4a"
    case "documentMessage":
      // Gunakan extension dari nama file jika ada
      if (mediaObj?.fileName) {
        const ext = path.extname(mediaObj.fileName)
        return ext || ".bin"
      }
      return ".bin"
    case "stickerMessage":
      return ".webp"
    default:
      return ".bin"
  }
}

// Helper: sanitize filename
const sanitizeFilename = (filename) => {
  if (!filename) return `file_${Date.now()}`
  // Hapus path separator dan karakter ilegal
  return filename
    .replace(/[/\\?%*:|"<>]/g, "_")
    .slice(0, 180)
    .trim() || `file_${Date.now()}`
}

// Helper: generate unique filename
const generateFilename = (messageType, originalName = null) => {
  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).substring(2, 8)

  if (originalName) {
    const sanitized = sanitizeFilename(originalName)
    return `${timestamp}_${randomSuffix}_${sanitized}`
  }

  return `${messageType}_${timestamp}_${randomSuffix}`
}

// Main function: download dan simpan media
const saveMediaToDisk = async (sock, fullMessage, mediaBuffer = null) => {
  try {
    // Normalize message (handle ephemeralMessage, viewOnceMessage, dll)
    let messageObj = normalizeMessage(fullMessage.message)
    if (!messageObj) {
      console.warn("[MEDIA AUTO-SAVE] Could not normalize message object")
      return false
    }

    // Deteksi tipe media
    const mediaType = getMediaType(messageObj)
    if (!mediaType || !MEDIA_FOLDERS[mediaType]) {
      // Bukan media type yang kami track
      return false
    }

    // Skip jika tipe tidak relevan
    if (mediaType === "unknownMessage") {
      return false
    }

    // Tentukan folder tujuan
    const folderName = MEDIA_FOLDERS[mediaType]
    const savePath = path.join(BASE_SAVE_DIR, folderName)

    // Ensure folder exists
    try {
      if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true })
      }
    } catch (e) {
      console.error(`[MEDIA AUTO-SAVE] Failed to ensure ${folderName} folder:`, e?.message || e)
      return false
    }

    // Download media jika belum ada buffer
    let buffer = mediaBuffer
    if (!buffer) {
      try {
        buffer = await downloadMediaMessage(
          fullMessage,
          "buffer",
          {},
          {
            logger: null, // silent logger
            reuploadRequest: sock.updateMediaMessage,
          }
        )
      } catch (downloadErr) {
        console.warn(`[MEDIA AUTO-SAVE] Failed to download ${mediaType}:`, downloadErr?.message || downloadErr)
        return false
      }
    }

    if (!buffer || buffer.length === 0) {
      console.warn("[MEDIA AUTO-SAVE] Downloaded buffer is empty")
      return false
    }

    // Tentukan nama file
    const mediaObj = messageObj[mediaType]
    let originalFilename = null

    // Coba ambil nama dari berbagai sumber
    if (mediaObj?.fileName) {
      originalFilename = mediaObj.fileName
    } else if (mediaObj?.caption) {
      originalFilename = mediaObj.caption.slice(0, 50).replace(/[/\\?%*:|"<>]/g, "_")
    } else if (mediaType === "documentMessage" && mediaObj?.title) {
      originalFilename = mediaObj.title
    }

    const ext = getFileExtension(mediaType, messageObj)
    const baseFilename = generateFilename(mediaType, originalFilename)
    const finalFilename = baseFilename.endsWith(ext) ? baseFilename : `${baseFilename}${ext}`
    const fullPath = path.join(savePath, finalFilename)

    // Simpan file
    try {
      fs.writeFileSync(fullPath, buffer)
      console.log(`[MEDIA AUTO-SAVE] Saved ${mediaType} to: ${fullPath} (${(buffer.length / 1024).toFixed(2)} KB)`)
      return true
    } catch (writeErr) {
      console.error(`[MEDIA AUTO-SAVE] Failed to write file ${fullPath}:`, writeErr?.message || writeErr)
      return false
    }
  } catch (err) {
    console.error("[MEDIA AUTO-SAVE] Unexpected error:", err?.message || err)
    return false
  }
}

// Main export: registrasi handler ke Baileys socket
export default function registerMediaAutoSave(sock, options = {}) {
  const { enabled = true, logger = console } = options

  if (!enabled) {
    logger.log("[MEDIA AUTO-SAVE] Disabled by configuration")
    return
  }

  // Ensure downloads folder structure
  ensureDownloadsFolder()

  // Registrasi event listener
  try {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return
        if (!Array.isArray(messages) || messages.length === 0) return

        for (const msg of messages) {
          try {
            // Skip jika tidak ada message
            if (!msg || !msg.message) continue

            // Skip status broadcasts
            if (msg.key.remoteJid === "status@broadcast") continue

            // Skip own messages (optional - hapus kondisi ini jika ingin simpan juga message bot sendiri)
            if (msg.key.fromMe) continue

            // Proses simpan media
            await saveMediaToDisk(sock, msg)
          } catch (msgErr) {
            console.warn("[MEDIA AUTO-SAVE] Error processing individual message:", msgErr?.message || msgErr)
            // Continue ke message berikutnya
          }
        }
      } catch (handlerErr) {
        console.error("[MEDIA AUTO-SAVE] Handler error:", handlerErr?.message || handlerErr)
      }
    })

    logger.log("[MEDIA AUTO-SAVE] Handler registered successfully. Media will be auto-saved to ./downloads/")
  } catch (e) {
    logger.error("[MEDIA AUTO-SAVE] Failed to register handler:", e?.message || e)
  }
}

// Export helper functions untuk keperluan manual save jika dibutuhkan
export { saveMediaToDisk, ensureDownloadsFolder, BASE_SAVE_DIR, MEDIA_FOLDERS }
