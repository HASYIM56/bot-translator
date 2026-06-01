// File: mediaAutoSave.js
import fs from "fs"
import path from "path"
import { downloadContentFromMessage } from "@whiskeysockets/baileys"

const BASE_MEDIA_DIR = path.join(path.sep, "HASYIM56")
const MEDIA_SAVE_DIR = path.join(BASE_MEDIA_DIR, "auto_save")

// Media type mapping to folder names
const MEDIA_FOLDERS = {
  imageMessage: "images",
  videoMessage: "videos",
  audioMessage: "audios",
  documentMessage: "documents",
  stickerMessage: "stickers",
  ephemeralMessage: "ephemeral",
  viewOnceMessage: "viewonce",
  viewOnceMessageV2: "viewonce_v2",
  pttMessage: "voice_notes",
  quotedMessage: "quoted",
}

// Initialize folder structure
const initializeFolders = () => {
  try {
    if (!fs.existsSync(MEDIA_SAVE_DIR)) {
      fs.mkdirSync(MEDIA_SAVE_DIR, { recursive: true })
      console.log(`[MEDIA SAVE] Created base directory: ${MEDIA_SAVE_DIR}`)
    }

    // Create all media type subdirectories
    for (const folderName of Object.values(MEDIA_FOLDERS)) {
      const folderPath = path.join(MEDIA_SAVE_DIR, folderName)
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
        console.log(`[MEDIA SAVE] Created subfolder: ${folderPath}`)
      }
    }
  } catch (err) {
    console.error("[MEDIA SAVE] Failed to initialize folders:", err?.message || err)
  }
}

// Detect file extension based on MIME type or magic bytes
const detectFileExtension = (buffer, mimeType = "") => {
  try {
    if (!buffer || buffer.length < 4) return ".bin"

    // Check magic bytes / file signatures
    const magic = buffer.slice(0, 12)

    // MIME type based detection
    if (mimeType) {
      if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg"
      if (mimeType.includes("png")) return ".png"
      if (mimeType.includes("webp")) return ".webp"
      if (mimeType.includes("gif")) return ".gif"
      if (mimeType.includes("mp4")) return ".mp4"
      if (mimeType.includes("mpeg")) return ".mp3"
      if (mimeType.includes("ogg")) return ".ogg"
      if (mimeType.includes("wav")) return ".wav"
      if (mimeType.includes("m4a")) return ".m4a"
      if (mimeType.includes("pdf")) return ".pdf"
      if (mimeType.includes("zip") || mimeType.includes("rar")) return ".zip"
    }

    // Magic byte detection
    if (magic[0] === 0xff && magic[1] === 0xd8) return ".jpg" // JPG
    if (magic[0] === 0x89 && magic[1] === 0x50) return ".png" // PNG
    if (magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46) return ".wav" // WAV/RIFF
    if (magic[0] === 0x49 && magic[1] === 0x44 && magic[2] === 0x33) return ".mp3" // MP3 ID3
    if (magic[0] === 0xff && (magic[1] === 0xfb || magic[1] === 0xf3)) return ".mp3" // MP3 raw
    if (magic[0] === 0x4f && magic[1] === 0x67 && magic[2] === 0x67) return ".ogg" // OGG
    if (magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 && buffer.slice(8, 12).toString() === "WEBP") return ".webp" // WEBP
    if (magic[0] === 0x47 && magic[1] === 0x49 && magic[2] === 0x46) return ".gif" // GIF
    if (magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46) return ".pdf" // PDF
    if (magic[0] === 0x50 && magic[1] === 0x4b) return ".zip" // ZIP/DOCX
    if (magic[0] === 0x1f && magic[1] === 0x8b) return ".gz" // GZIP

    // fallback
    return ".bin"
  } catch (e) {
    console.warn("[MEDIA SAVE] Extension detection failed:", e?.message || e)
    return ".bin"
  }
}

// Normalize date string for folder organization
const getDateFolder = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Generate unique filename
const generateFilename = (originalName = "", extension = ".bin") => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const sanitized = originalName
    ? originalName.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 50)
    : `media_${timestamp}`
  return `${sanitized}_${timestamp}_${random}${extension}`
}

// Download and save media
const downloadAndSaveMedia = async (sock, messageNode, mediaType, mediaObject, sender, remoteJid) => {
  try {
    // Determine download type and folder
    const folderName = MEDIA_FOLDERS[mediaType] || "unknown"
    const mimeType = mediaObject?.mimetype || ""
    
    // Infer download type
    let downloadType = "buffer"
    if (mediaType === "imageMessage" || mediaType === "stickerMessage") downloadType = "image"
    else if (mediaType === "videoMessage") downloadType = "video"
    else if (mediaType === "audioMessage" || mediaType === "pttMessage") downloadType = "audio"
    else if (mediaType === "documentMessage") downloadType = "document"

    // Download stream
    let stream
    try {
      stream = await downloadContentFromMessage(mediaObject, downloadType)
    } catch (downloadErr) {
      console.warn(`[MEDIA SAVE] Failed to create download stream for ${mediaType}:`, downloadErr?.message || downloadErr)
      return null
    }

    if (!stream) {
      console.warn(`[MEDIA SAVE] No download stream available for ${mediaType}`)
      return null
    }

    // Accumulate buffer from stream
    let buffer = Buffer.from([])
    try {
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
        // Safety: limit to 100MB per file
        if (buffer.length > 100 * 1024 * 1024) {
          console.warn(`[MEDIA SAVE] Media exceeded 100MB limit for ${mediaType}, truncating`)
          break
        }
      }
    } catch (streamErr) {
      console.warn(`[MEDIA SAVE] Error reading stream for ${mediaType}:`, streamErr?.message || streamErr)
      return null
    }

    if (!buffer || buffer.length === 0) {
      console.warn(`[MEDIA SAVE] Downloaded buffer is empty for ${mediaType}`)
      return null
    }

    // Detect extension
    const extension = detectFileExtension(buffer, mimeType)

    // Generate filename
    const originalName = mediaObject?.fileName || mediaObject?.filename || ""
    const filename = generateFilename(originalName, extension)

    // Create date-based subfolder
    const dateFolder = getDateFolder()
    const senderFolder = String(sender).replace(/[^0-9]/g, "")
    const folderPath = path.join(MEDIA_SAVE_DIR, folderName, dateFolder, senderFolder)

    // Ensure folder exists
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
      }
    } catch (mkdirErr) {
      console.error(`[MEDIA SAVE] Failed to create directory ${folderPath}:`, mkdirErr?.message || mkdirErr)
      return null
    }

    // Write file
    const filepath = path.join(folderPath, filename)
    try {
      fs.writeFileSync(filepath, buffer)
      console.log(`[MEDIA SAVE] Saved ${mediaType}: ${filepath} (${(buffer.length / 1024).toFixed(2)} KB)`)
      return {
        success: true,
        filepath,
        size: buffer.length,
        mediaType,
        extension,
        sender,
        timestamp: Date.now(),
      }
    } catch (writeErr) {
      console.error(`[MEDIA SAVE] Failed to write file ${filepath}:`, writeErr?.message || writeErr)
      return null
    }
  } catch (err) {
    console.error("[MEDIA SAVE] Unexpected error in downloadAndSaveMedia:", err?.message || err)
    return null
  }
}

// Normalize message object to handle ephemeral/viewOnce messages
const normalizeMessage = (message) => {
  try {
    if (!message) return null

    // Handle ephemeral messages
    if (message.ephemeralMessage?.message) {
      return message.ephemeralMessage.message
    }

    // Handle view-once messages (V2)
    if (message.viewOnceMessageV2?.message) {
      return message.viewOnceMessageV2.message
    }

    // Handle view-once messages (V1)
    if (message.viewOnceMessage?.message) {
      return message.viewOnceMessage.message
    }

    return message
  } catch (e) {
    console.warn("[MEDIA SAVE] Error normalizing message:", e?.message || e)
    return message
  }
}

// Main handler: register media auto-save
const registerMediaAutoSave = (sock, opts = {}) => {
  try {
    const {
      enabled = true,
      logger = console,
      includeBotMessages = true, // Include messages sent by the bot itself
    } = opts

    if (!enabled) {
      console.log("[MEDIA SAVE] Media auto-save is disabled")
      return
    }

    // Initialize folders on startup
    initializeFolders()

    // Register listener
    if (!sock.ev || typeof sock.ev.on !== "function") {
      console.warn("[MEDIA SAVE] Socket event emitter not available")
      return
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return
        if (!Array.isArray(messages) || messages.length === 0) return

        for (const msg of messages) {
          try {
            if (!msg || !msg.key || !msg.message) continue

            // Skip status updates
            if (msg.key.remoteJid === "status@broadcast") continue

            // Extract sender information
            const from = msg.key.remoteJid
            const isGroup = String(from || "").endsWith("@g.us")
            const sender = isGroup ? msg.key.participant || from : from
            const isFromBot = msg.key.fromMe === true

            // Skip own messages if includeBotMessages is false
            if (isFromBot && !includeBotMessages) continue

            // Normalize message (handle ephemeral, viewOnce, etc)
            const normalizedMsg = normalizeMessage(msg.message)
            if (!normalizedMsg) continue

            // Get all media types in this message
            const mediaTypes = Object.keys(normalizedMsg)

            for (const mediaType of mediaTypes) {
              // Check if it's a supported media type
              if (!MEDIA_FOLDERS[mediaType]) continue

              const mediaObject = normalizedMsg[mediaType]
              if (!mediaObject) continue

              // Download and save
              const result = await downloadAndSaveMedia(sock, msg, mediaType, mediaObject, sender, from)

              if (result) {
                logger?.log?.(`[MEDIA SAVE] Successfully saved ${mediaType} from ${String(sender).split("@")[0]}`)
              }
            }
          } catch (msgErr) {
            logger?.warn?.(`[MEDIA SAVE] Error processing individual message:`, msgErr?.message || msgErr)
          }
        }
      } catch (upsertErr) {
        logger?.error?.("[MEDIA SAVE] Error in messages.upsert handler:", upsertErr?.message || upsertErr)
      }
    })

    console.log("[MEDIA SAVE] Auto-save system initialized and listening for media")
  } catch (err) {
    console.error("[MEDIA SAVE] Failed to register media auto-save:", err?.message || err)
  }
}

export default registerMediaAutoSave