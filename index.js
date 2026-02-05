import {
  makeWASocket,
  useMultiFileAuthState,
  downloadContentFromMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys"

import axios from "axios"
import qrcode from "qrcode-terminal"
import fs from "fs"
import Pino from "pino"
import sharp from "sharp"
import { translate as h56Translate, supportedLanguages as h56SupportedLanguages } from "h56-translator"
import { generateQRCode, base64ToBuffer } from "./qrcode.js"

import path from "path"
import os from "os"
import ffmpegPath from "ffmpeg-static"
import { spawn } from "child_process" // added for ffmpeg conversion

import registerBlock from "./block.js"
// IMPORT: mediafire handler
import registerMediafire from "./mediafire.js"
// Tambahkan pada bagian import (di dekat import lain)
import startRealtimeBioUpdater from "./realtime-bio.js"
// Github Saerch Handler
import githubSearchHandler from "./handlers/githubSearch.js"

// ======================
// SYSTEM CONFIG
// ======================
const SESSION_FOLDER = "./session"
const CONFIG_FOLDER = "./config"
const OWNERS_FILE = `${CONFIG_FOLDER}/owners.json`
const ACCESS_MODE_FILE = `${CONFIG_FOLDER}/access-mode.json` // Added access mode config file
// === ADD: AUTOREACT PERSISTENT CONFIG (INSERT AFTER ACCESS_MODE_FILE) ===
// File: CONFIG_FOLDER/autoreact.json
const AUTOREACT_CONFIG_FILE = `${CONFIG_FOLDER}/autoreact.json`

// Runtime flag (default true — kompatibel dengan perilaku saat ini)
let AUTO_REACT_ENABLED = true

const loadAutoReactConfig = () => {
  try {
    if (!fs.existsSync(CONFIG_FOLDER)) fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
    if (fs.existsSync(AUTOREACT_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUTOREACT_CONFIG_FILE, "utf8"))
      if (typeof raw.enabled === "boolean") {
        AUTO_REACT_ENABLED = raw.enabled
      } else if (typeof raw === "boolean") {
        AUTO_REACT_ENABLED = raw
      }
    }
  } catch (e) {
    console.warn("[AUTOREACT] Gagal memuat config autoreact, menggunakan default=true:", e?.message || e)
    AUTO_REACT_ENABLED = true
  }
  console.log(`[AUTOREACT] Initialized (enabled=${AUTO_REACT_ENABLED})`)
  return AUTO_REACT_ENABLED
}

const saveAutoReactConfig = (enabled) => {
  try {
    if (!fs.existsSync(CONFIG_FOLDER)) fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
    fs.writeFileSync(AUTOREACT_CONFIG_FILE, JSON.stringify({ enabled: Boolean(enabled), updatedAt: new Date().toISOString() }, null, 2))
    AUTO_REACT_ENABLED = Boolean(enabled)
    console.log(`[AUTOREACT] Saved setting enabled=${AUTO_REACT_ENABLED}`)
  } catch (e) {
    console.error("[AUTOREACT] Gagal menyimpan config autoreact:", e?.message || e)
  }
}
// === END ADD: AUTOREACT CONFIG ===
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"]

const STICKER_PACK_NAME = "HASYIM56 MODDER"
const STICKER_AUTHOR = "Powered by H56"

// Permanent base media directory and subfolders (per request)
const BASE_MEDIA_DIR = path.join(path.sep, "HASYIM56")
const YOUTUBE_FOLDER = path.join(BASE_MEDIA_DIR, "youtube")
const QRCODE_FOLDER = path.join(BASE_MEDIA_DIR, "qrcode")
const MEDIAFIRE_FOLDER = path.join(BASE_MEDIA_DIR, "mediafire")
const AUDIO_FOLDER = path.join(BASE_MEDIA_DIR, "audio")
const STICKER_FOLDER = path.join(BASE_MEDIA_DIR, "sticker")

// For backward compatibility with code that expects TEMP_FOLDER, keep the variable name.
// TEMP_FOLDER will point to the mediafire folder (used widely as temporary/media storage in current code).
const TEMP_FOLDER = MEDIAFIRE_FOLDER

// Ensure folder config and permanent media folders exist
const ensureFoldersExist = () => {
  if (!fs.existsSync(CONFIG_FOLDER)) {
    fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
  }

  try {
    // Ensure base permanent media folder exists
    if (!fs.existsSync(BASE_MEDIA_DIR)) {
      fs.mkdirSync(BASE_MEDIA_DIR, { recursive: true })
      console.log(`[FS] Created base media folder: ${BASE_MEDIA_DIR}`)
    }

    // Ensure specific subfolders exist
    if (!fs.existsSync(YOUTUBE_FOLDER)) {
      fs.mkdirSync(YOUTUBE_FOLDER, { recursive: true })
      console.log(`[FS] Created youtube folder: ${YOUTUBE_FOLDER}`)
    }
    if (!fs.existsSync(QRCODE_FOLDER)) {
      fs.mkdirSync(QRCODE_FOLDER, { recursive: true })
      console.log(`[FS] Created qrcode folder: ${QRCODE_FOLDER}`)
    }
    if (!fs.existsSync(MEDIAFIRE_FOLDER)) {
      fs.mkdirSync(MEDIAFIRE_FOLDER, { recursive: true })
      console.log(`[FS] Created mediafire folder: ${MEDIAFIRE_FOLDER}`)
    }
    if (!fs.existsSync(AUDIO_FOLDER)) {
      fs.mkdirSync(AUDIO_FOLDER, { recursive: true })
      console.log(`[FS] Created audio folder: ${AUDIO_FOLDER}`)
    }
    if (!fs.existsSync(STICKER_FOLDER)) {
      fs.mkdirSync(STICKER_FOLDER, { recursive: true })
      console.log(`[FS] Created sticker folder: ${STICKER_FOLDER}`)
    }
  } catch (err) {
    console.error("[FS] Error ensuring media folders exist:", err?.message || err)
  }
}

ensureFoldersExist()

// ======================
// BOT RUNTIME / BIO - START TIME
// ======================
const BOT_START_TIME = Date.now() // Catat waktu mulai bot
let bioInterval = null // handle for periodic bio updates

// ======================
// OWNER CONFIG
// ======================
const OWNER_NUMBER = "225503449452694"
const DEV_NUMBER = "6285888663485"
const DEV_NAME = "@HASYIM56"
const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`

let authState
let BOT_ACCESS_MODE
let forwardManyTimesEnabled = false // Forward Many Times Mode flag (runtime only)

const loadAccessMode = () => {
  try {
    if (fs.existsSync(ACCESS_MODE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCESS_MODE_FILE, "utf-8"))
      return data.mode || "public"
    }
  } catch (err) {
    console.error("[ACCESS MODE] Error loading config:", err.message)
  }
  return "public"
}

const saveAccessMode = (mode) => {
  try {
    fs.writeFileSync(ACCESS_MODE_FILE, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2))
    console.log(`[ACCESS MODE] Mode changed to: ${mode}`)
  } catch (err) {
    console.error("[ACCESS MODE] Error saving config:", err.message)
  }
}

/**
 * loadOwners
 * Returns an array of owner numbers (strings). If file not present, returns [OWNER_NUMBER].
 */
const loadOwners = () => {
  try {
    if (fs.existsSync(OWNERS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(OWNERS_FILE, "utf-8"))

      // If file is an array of owners (legacy)
      if (Array.isArray(raw) && raw.length > 0) {
        // return a copy to avoid accidental mutation
        return Array.from(new Set(raw.map((o) => String(o).trim()).filter(Boolean)))
      }

      // If file is object with { owners: [...] }
      if (raw && Array.isArray(raw.owners) && raw.owners.length > 0) {
        return Array.from(new Set(raw.owners.map((o) => String(o).trim()).filter(Boolean)))
      }

      // If file contains other shapes, try to coerce values
      if (typeof raw === "object" && raw !== null) {
        const vals = Object.values(raw)
          .flat(Infinity)
          .map((v) => (v == null ? "" : String(v).trim()))
          .filter(Boolean)
        if (vals.length > 0) return Array.from(new Set(vals))
      }
    }
  } catch (err) {
    console.error("[OWNERS] Error loading owners.json:", err?.message || err)
    // fallthrough to default owners
  }

  // Default owners (kept minimal & explicit):
  // - OWNER_NUMBER remains the primary owner (kept for backward compatibility)
  // - Add requested additional owner number(s) here
  const defaults = [OWNER_NUMBER, "6285888663485"]

  // Deduplicate and return
  return Array.from(new Set(defaults.map((o) => String(o).trim()).filter(Boolean)))
}

/**
 * saveOwners
 * - Saves owners in the structured format per spec:
 *   { "owners": ["6281234567890@s.whatsapp.net", ...] }
 */
const saveOwners = (owners) => {
  try {
    const payload = { owners: owners }
    fs.writeFileSync(OWNERS_FILE, JSON.stringify(payload, null, 2))
  } catch (err) {
    console.error("[OWNERS] Error saving owners.json:", err.message)
  }
}

const normalizeNumber = (num) => {
  if (!num) return ""
  let normalized = String(num).replace(/\D/g, "")

  // Jika dimulai dengan 0, ganti dengan 62
  if (normalized.startsWith("0")) {
    normalized = "62" + normalized.substring(1)
  }

  // Jika masih tidak ada 62, tambahkan
  if (!normalized.startsWith("62") && normalized.length > 0) {
    normalized = "62" + normalized
  }

  return normalized
}

const isUserOwner = (senderNumber) => {
  try {
    const owners = loadOwners()
    const normalized = normalizeNumber(senderNumber)
    const normalizedMainOwner = normalizeNumber(OWNER_NUMBER)

    // Debug log untuk membantu troubleshooting
    console.log(`[OWNER CHECK] Sender: ${senderNumber} -> Normalized: ${normalized} | Owner: ${normalizedMainOwner}`)

    // Cek owner utama atau owner tambahan
    const isOwner =
      owners.some((owner) => {
        const normalizedOwner = normalizeNumber(owner)
        return normalizedOwner === normalized
      }) || normalized === normalizedMainOwner

    if (isOwner) {
      console.log(`[OWNER VERIFIED] ${normalized} is owner`)
    }

    return isOwner
  } catch (err) {
    console.error("[OWNER CHECK ERROR]", err.message)
    return false
  }
}

const extractJidNumber = (jid) => {
  if (!jid) return ""
  return String(jid).split("@")[0].split(":")[0]
}

const isBotAdmin = async (sock, groupJid) => {
  try {
    const groupMetadata = await sock.groupMetadata(groupJid)
    const botId = sock.user.lid || sock.user.id
    const botJidNumber = extractJidNumber(botId)

    console.log(`[ADMIN CHECK] Bot ID: ${botId}, extracted: ${botJidNumber}`)
    console.log(`[ADMIN CHECK] Group participants count: ${groupMetadata.participants.length}`)

    // Find bot in participants with multiple matching strategies
    const botParticipant = groupMetadata.participants.find((p) => {
      const participantNumber = extractJidNumber(p.id)
      const exactMatch = botJidNumber === participantNumber
      const fullIdMatch = botId === p.id

      if (exactMatch || fullIdMatch) {
        console.log(`[ADMIN CHECK] Found bot participant: ${p.id}, admin: ${p.admin}`)
        return true
      }
      return false
    })

    if (!botParticipant) {
      console.log(`[ADMIN CHECK] Bot not found in participants. Bot ID: ${botId}`)
      console.log(
        `[ADMIN CHECK] Available participants:`,
        groupMetadata.participants.map((p) => ({ id: p.id, admin: p.admin })),
      )
      return false
    }

    const isAdmin = botParticipant.admin === "admin" || botParticipant.admin === "superadmin"
    console.log(`[ADMIN CHECK] Bot admin status: ${isAdmin} (admin field: "${botParticipant.admin}")`)

    return isAdmin
  } catch (err) {
    console.error("[ADMIN CHECK ERROR]", err.message)
    console.error("[ADMIN CHECK ERROR] Stack:", err.stack)
    return false
  }
}

// ======================
// LOGGER
// ======================
const logger = Pino({ level: "silent" })

// ======================
// HELPER FUNCTIONS
// ======================

const normalizeJid = (jid) => {
  if (!jid) return ""
  return String(jid).replace(/[^0-9]/g, "")
}

const TRANSLATE_LANGUAGES = {
  id: "Indonesian",
  en: "English",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  fr: "French",
  de: "German",
  ru: "Russian",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  th: "Thai",
  vi: "Vietnamese",
  hi: "Hindi",
  bn: "Bengali",
  sw: "Swahili",
}

const getLanguageList = () => {
  return Object.entries(TRANSLATE_LANGUAGES)
    .map(([code, name]) => `${code} - ${name}`)
    .join("\n")
}

const encodeUnicodeText = (text) => {
  try {
    if (typeof text !== "string") return String(text)
    // Ensure proper UTF-8 encoding
    return Buffer.from(text, "utf-8").toString("utf-8")
  } catch (err) {
    console.error("[UNICODE ENCODING ERROR]", err.message)
    return text
  }
}

// ======================
// RUNTIME FORMAT & BIO UPDATE
// ======================

/**
 * formatRuntime
 * Converts milliseconds to formatted string "Xh Ym Zs"
 */
function formatRuntime(ms) {
  try {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours}h ${minutes}m ${seconds}s`
  } catch (e) {
    return "0h 0m 0s"
  }
}

/**
 * updateBio
 * Updates WhatsApp "About" / profile status with runtime info.
 * Uses sock.updateProfileStatus if available.
 */
async function updateBio(sock) {
  try {
    if (!sock) return
    if (typeof sock.updateProfileStatus !== "function") {
      console.warn("[BIO] updateProfileStatus not available on sock instance.")
      return
    }

    const runtime = formatRuntime(Date.now() - BOT_START_TIME)
    const statusText = `🤖 H56 Whatsapp Bot | Runtime: ${runtime}`

    await sock.updateProfileStatus(statusText)
    console.log("[BIO] Updated profile status:", statusText)
  } catch (err) {
    console.error("[BIO] Gagal update bio:", err?.message || err)
  }
}

// ======================
// INITIALIZE BOT
// ======================
// initializeBot
const initializeBot = async () => {
  // Pastikan authState sudah di-load sebelum memanggil fungsi ini
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`Using WA v${version.join(".")}, isLatest: ${isLatest}`)

  // Defensive: pastikan SESSION_FOLDER ada (useMultiFileAuthState membuat file, tapi pastikan folder)
  try {
    const resolved = path.resolve(SESSION_FOLDER)
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true })
      console.log(`[AUTH] Created session folder: ${resolved}`)
    }
  } catch (e) {
    console.warn("[AUTH] Could not ensure session folder exists:", e?.message || e)
  }

  // Build socket with existing auth state (if any)
  const sock = makeWASocket({
    version,
    auth: authState?.state,
    printQRInTerminal: false,
    logger,
    browser: ["H56 Bot", "Chrome", "10.0"],
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
  })

  // IMPORTANT: attach creds.update handler so useMultiFileAuthState saves credentials automatically
  try {
    if (authState && typeof authState.saveCreds === "function") {
      // attach once per socket instance
      sock.ev.on("creds.update", async (creds) => {
        try {
          await authState.saveCreds(creds)
          // Minimal log for audits
          // avoid flooding logs in prod; keep it informative
          console.log("[AUTH] creds.update handled and saved.")
        } catch (e) {
          console.error("[AUTH] Failed to save creds on creds.update:", e?.message || e)
        }
      })
      console.log("[AUTH] Attached creds.update -> saveCreds listener.")
    } else {
      console.warn("[AUTH] authState.saveCreds not available; credentials may not persist.")
    }
  } catch (e) {
    console.error("[AUTH] Error attaching creds.update listener:", e?.message || e)
  }

  return sock
}
// initializeBot

// =============================
// HELPER FUNCTION - STICKER CONVERSION (IMPROVED)
// =============================
const convertToSticker = async (imageBuffer) => {
  let tempImagePath = null
  let stickerPath = null

  try {
    // Generate unique filenames with timestamp
    const timestamp = Date.now()
    const randomSuffix = Math.random().toString(36).substring(7)
    tempImagePath = path.join(STICKER_FOLDER, `temp_${timestamp}_${randomSuffix}.png`)
    stickerPath = path.join(STICKER_FOLDER, `sticker_${timestamp}_${randomSuffix}.webp`)

    // Validate temp folder exists and is writable
    if (!fs.existsSync(STICKER_FOLDER)) {
      fs.mkdirSync(STICKER_FOLDER, { recursive: true })
      console.log(`[STICKER] Created sticker folder: ${STICKER_FOLDER}`)
    }

    // Write buffer to temporary file with proper encoding
    fs.writeFileSync(tempImagePath, imageBuffer, { encoding: null })

    // Verify temp file was created successfully
    if (!fs.existsSync(tempImagePath)) {
      throw new Error(`Failed to write temporary image file at ${tempImagePath}`)
    }

    const fileStats = fs.statSync(tempImagePath)
    console.log(`[STICKER] Temp file created: ${fileStats.size} bytes`)

    // Convert and resize image to sticker format (512x512)
    await sharp(tempImagePath)
      .resize(512, 512, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .webp({ quality: 80 })
      .toFile(stickerPath)

    // Verify sticker file was created successfully
    if (!fs.existsSync(stickerPath)) {
      throw new Error(`Failed to create sticker file at ${stickerPath}`)
    }

    // Read converted sticker
    const stickerBuffer = fs.readFileSync(stickerPath)
    console.log(`[STICKER] Sticker created successfully: ${stickerBuffer.length} bytes`)

    return stickerBuffer
  } catch (err) {
    console.error("[STICKER CONVERSION ERROR]", {
      message: err.message,
      code: err.code,
      tempImagePath,
      stickerPath,
    })
    throw new Error(`Sticker conversion failed: ${err.message}`)
  } finally {
    try {
      // Clean up temporary files safely
      if (tempImagePath && fs.existsSync(tempImagePath)) {
        fs.unlinkSync(tempImagePath)
        console.log(`[STICKER] Cleaned up temp image`)
      }
      if (stickerPath && fs.existsSync(stickerPath)) {
        fs.unlinkSync(stickerPath)
        console.log(`[STICKER] Cleaned up sticker file`)
      }
    } catch (cleanupErr) {
      console.warn("[STICKER CLEANUP WARNING]", cleanupErr.message)
      // Don't throw during cleanup, just log warning
    }
  }
}

// HELPER FUNCTION - AUDIO -> OGG/OPUS (FOR VOICE NOTE)
// Uses ffmpeg CLI via child_process.spawn
const detectAudioExtension = (buffer) => {
  try {
    if (!buffer || buffer.length < 4) return ".tmp"
    const first4 = buffer.slice(0, 4).toString("utf8", 0, 4)
    const first3 = buffer.slice(0, 3).toString("utf8", 0, 3)
    const b0 = buffer[0]
    const b1 = buffer[1]

    if (first4 === "RIFF") return ".wav"
    if (first4 === "OggS") return ".ogg"
    if (first4 === "fLaC") return ".flac"
    if (first3 === "ID3") return ".mp3"
    if (b0 === 0xff && (b1 === 0xfb || b1 === 0xf3 || b1 === 0xf2)) return ".mp3"
    // m4a / mp4 often have 'ftyp' at offset 4
    if (buffer.length > 8 && buffer.slice(4, 8).toString() === "ftyp") return ".m4a"
    return ".tmp"
  } catch (e) {
    return ".tmp"
  }
}

const convertAudioToOggOpus = async (inputBuffer) => {
  // Ensure permanent audio folder exists right before writing
  try {
    if (!fs.existsSync(AUDIO_FOLDER)) {
      fs.mkdirSync(AUDIO_FOLDER, { recursive: true })
      console.log(`[AUDIO->OGG] Created audio folder: ${AUDIO_FOLDER}`)
    }
  } catch (e) {
    throw new Error(`Failed to ensure audio folder exists: ${e.message}`)
  }

  // Create unique filenames inside AUDIO_FOLDER
  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).substring(7)
  const inputExt = detectAudioExtension(inputBuffer) || ".tmp"
  const inputPath = path.join(AUDIO_FOLDER, `audio_in_${timestamp}_${randomSuffix}${inputExt}`)
  const outputPath = path.join(AUDIO_FOLDER, `audio_out_${timestamp}_${randomSuffix}.ogg`)

  try {
    // Write input to disk
    fs.writeFileSync(inputPath, inputBuffer, { encoding: null, flag: "w" })

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Failed to write input file at ${inputPath}`)
    }
  } catch (writeErr) {
    // Provide clear error message if writing failed
    throw new Error(`Unable to write temporary input file: ${writeErr.message}`)
  }

  return new Promise((resolve, reject) => {
    // ffmpeg args:
    // -y overwrite, -i input, -c:a libopus, -b:a 64k, -vbr on, -application audio, -ac 1, -ar 48000, output.ogg
    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      "-vbr",
      "on",
      "-application",
      "audio",
      "-ac",
      "1",
      "-ar",
      "48000",
      outputPath,
    ]

    let ff
    try {
      ff = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] })
    } catch (spawnErr) {
      // Spawn itself failed (e.g., ffmpeg missing)
      // Cleanup input file before rejecting
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
      } catch (e) {}
      return reject(new Error(`Failed to start ffmpeg process: ${spawnErr.message}`))
    }

    let stderr = ""
    ff.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    ff.on("error", (err) => {
      // cleanup input file
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
      } catch (e) {}
      // If ffmpeg binary not found, err.code is usually 'ENOENT'
      if (err && err.code === "ENOENT") {
        return reject(new Error("ffmpeg not found. Pastikan ffmpeg terinstall dan dapat diakses di PATH."))
      }
      return reject(new Error(`ffmpeg process error: ${err.message}`))
    })

    ff.on("close", (code) => {
      // cleanup input file
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
      } catch (e) {
        console.warn("[AUDIO CLEANUP WARNING]", e.message)
      }

      if (code !== 0) {
        // ensure output removed if exists
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        } catch (e) {}
        return reject(new Error(`ffmpeg exited with code ${code}. stderr: ${stderr}`))
      }

      try {
        const outBuffer = fs.readFileSync(outputPath)
        // cleanup output file
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        } catch (e) {}
        resolve(outBuffer)
      } catch (readErr) {
        reject(new Error(`Failed to read ffmpeg output: ${readErr.message}`))
      }
    })
  })
}

// ======================
// START BOT FUNCTION
// ======================

const startBot = async () => {
  const sock = await initializeBot()
  

  // Wrapper: Intercept sock.sendMessage to inject forwarding metadata when enabled
  try {
    if (sock && typeof sock.sendMessage === "function") {
      const originalSendMessage = sock.sendMessage.bind(sock)
      sock.sendMessage = async (jid, message, options = {}) => {
        try {
          if (forwardManyTimesEnabled && message && typeof message === "object") {
            // Avoid interfering with deletion payloads (delete property) or unexpected shapes
            // But still attempt to safely add contextInfo when possible
            try {
              // If message is a Buffer or string, we can't add contextInfo; skip
              if (Buffer.isBuffer(message) || typeof message === "string") {
                // Do nothing; call original
              } else {
                // Merge or create contextInfo
                const existingCtx = message.contextInfo && typeof message.contextInfo === "object" ? { ...message.contextInfo } : {}
                existingCtx.isForwarded = true
                // Ensure a large forwardingScore (>=50). Use high value 999 to indicate "forwarded many times"
                existingCtx.forwardingScore = Math.max(Number(existingCtx.forwardingScore) || 0, 999)
                // Assign back
                message = { ...message, contextInfo: existingCtx }
              }
            } catch (innerErr) {
              console.warn("[FWD MODE] Failed to attach contextInfo:", innerErr.message)
            }
          }
        } catch (outerErr) {
          console.warn("[FWD MODE] Unexpected error in sendMessage wrapper:", outerErr.message)
        }
        // Call original
        return originalSendMessage(jid, message, options)
      }
      console.log("[FWD MODE] sendMessage wrapper installed.")
    }
  } catch (err) {
    console.error("[FWD MODE] Error installing wrapper:", err.message)
  }
  
  // === ADD: Autoreact toggle command + sendMessage filter (INSERT INSIDE startBot() after FWD MODE wrapper) ===

// Ensure autoreact config is loaded on each socket start
try {
  loadAutoReactConfig()
} catch (e) {
  // already handled inside loadAutoReactConfig
}

// Lightweight sendMessage filter to suppress outgoing reaction payloads when autoreact is disabled.
// This wrapper is intentionally conservative: it only intercepts messages that contain a top-level `react` property.
// It forwards everything else unchanged and preserves existing wrappers' behavior.
try {
  if (sock && typeof sock.sendMessage === "function") {
    const _origSendMessage = sock.sendMessage.bind(sock)
    // Avoid double-wrapping
    if (!_origSendMessage.__autoreactFilterInstalled) {
      const filteredSendMessage = async (jid, message, options = {}) => {
        try {
          // If autoreact is disabled and the outgoing message is a reaction payload, ignore it
          // Common reaction payload shape: { react: { text: "...", key: {...} } }
          const isReactionPayload = message && typeof message === "object" && (message.react || message.reactionMessage)
          if (!AUTO_REACT_ENABLED && isReactionPayload) {
            // Log at debug level, don't throw
            console.log(`[AUTOREACT] Suppressed outgoing reaction to ${jid} because autoreact is disabled.`)
            // Return a resolved promise with a minimal shape to keep call sites happy
            return { status: "suppressed", jid, messageType: "react" }
          }
        } catch (e) {
          // If anything goes wrong in our check, fall through to sending the message to avoid breaking bot
          console.warn("[AUTOREACT] Error in sendMessage filter (falling back to original send):", e?.message || e)
        }
        // Call original sendMessage
        return _origSendMessage(jid, message, options)
      }
      // mark wrapper to avoid re-wrapping later
      filteredSendMessage.__autoreactFilterInstalled = true
      sock.sendMessage = filteredSendMessage
      console.log("[AUTOREACT] sendMessage filter installed (will suppress react payloads if disabled).")
    }
  }
} catch (e) {
  console.warn("[AUTOREACT] Failed to install sendMessage filter:", e?.message || e)
}

// Command handler: .autoreact on / .autoreact off
// Minimal, self-contained messages.upsert listener that only implements the command and nothing else.
// This listener is intentionally narrow in scope and respects BOT_ACCESS_MODE and owner checks.
try {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return
      if (!Array.isArray(messages) || messages.length === 0) return

      const msg = messages[0]
      if (!msg || !msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = String(sender).split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isFromBot = msg.key.fromMe === true

      // Respect private mode behavior (same as other handlers)
      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

      // extract text safely
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
      const args = text.trim().split(/\s+/)
      const cmd = (args[0] || "").toLowerCase()

      if (cmd !== ".autoreact") return

      // Only Owner Utama allowed
      if (!isMainOwner) {
        await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner Utama: hanya Owner Utama yang dapat mengubah pengaturan autoreact.") }, { quoted: msg })
        return
      }

      const sub = (args[1] || "").toLowerCase()
      if (sub === "on") {
        if (AUTO_REACT_ENABLED) {
          await sock.sendMessage(from, { text: encodeUnicodeText("AutoReact sudah aktif.") }, { quoted: msg })
          return
        }
        saveAutoReactConfig(true)
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ AutoReact telah diaktifkan. Bot akan mengirim reaksi secara otomatis." ) }, { quoted: msg })
        console.log(`[AUTOREACT] Enabled by owner ${senderNumber} at ${new Date().toISOString()}`)
        return
      }

      if (sub === "off") {
        if (!AUTO_REACT_ENABLED) {
          await sock.sendMessage(from, { text: encodeUnicodeText("AutoReact sudah nonaktif.") }, { quoted: msg })
          return
        }
        saveAutoReactConfig(false)
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ AutoReact telah dinonaktifkan. Bot tidak akan lagi mengirim reaksi otomatis." ) }, { quoted: msg })
        console.log(`[AUTOREACT] Disabled by owner ${senderNumber} at ${new Date().toISOString()}`)
        return
      }

      // Help text
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .autoreact <on|off>\nContoh: .autoreact on\n\nHanya Owner Utama yang dapat menjalankan perintah ini.") }, { quoted: msg })
    } catch (err) {
      console.error("[AUTOREACT HANDLER] Error:", err?.message || err)
    }
  })
  console.log("[AUTOREACT] Command handler installed (.autoreact on / .autoreact off).")
} catch (e) {
  console.error("[AUTOREACT] Failed to register command handler:", e?.message || e)
}
// === END ADD: Autoreact toggle command + sendMessage filter ===
  
  // Integrasi block.js: memastikan module ter-registrasi setelah sendMessage wrapper diinstal
try {
  await registerBlock(sock, {
    CONFIG_FOLDER,
    BLOCKED_FILE: `${CONFIG_FOLDER}/blocked-user.json`,
    OWNER_NUMBER,
    isUserOwner,
    normalizeNumber,
    logger,
    encodeUnicodeText
  })
  console.log("[BLOCK INTEGRATION] registerBlock executed.")
} catch (err) {
  console.error("[BLOCK INTEGRATION] registerBlock failed:", err?.message || err)
}
  
  // Method to integrate block.js into index.js without adding a top-level import.
// Place and call this async function in startBot() right after the sendMessage wrapper is installed.
//
// Example insertion point (inside startBot, immediately after):
//   console.log("[FWD MODE] sendMessage wrapper installed.")
//   await integrateBlockModule(sock)
//

async function integrateBlockModule(sock) {
  try {
    // Dynamic import so you don't need to add a static top-level import line in index.js
    const { default: registerBlock } = await import("./block.js")

    // Call registerBlock with the expected options (matches the block.js API)
    await registerBlock(sock, {
      CONFIG_FOLDER, // existing constant in index.js
      BLOCKED_FILE: `${CONFIG_FOLDER}/blocked-user.json`,
      OWNER_NUMBER, // existing constant in index.js
      isUserOwner, // existing helper function in index.js
      normalizeNumber, // existing helper function in index.js
      logger, // existing logger instance in index.js
      encodeUnicodeText, // existing helper function in index.js
    })

    console.log("[BLOCK INTEGRATION] registerBlock completed successfully.")
  } catch (err) {
    console.error("[BLOCK INTEGRATION] Failed to register block module:", err?.message || err)
  }
}

  // REGISTER MEDIAFIRE HANDLER
  await registerMediafire(sock, { getAccessMode: () => BOT_ACCESS_MODE, isUserOwner, normalizeNumber, OWNER_NUMBER, TEMP_FOLDER, MAX_DOWNLOAD_SIZE: 150 * 1024 * 1024 })

// ANTI-DELETE
try {
  // Antidelete config persistence
  const ANTIDELETE_CONFIG_FILE = path.join(CONFIG_FOLDER, "antidelete.json")
  const ANTIDELETE_CACHE_DIR = path.join(BASE_MEDIA_DIR, "antidelete_cache")
  const DEFAULT_ANTIDELETE_CONFIG = {
    enabled: false,
    textOnly: true,       // true => text-only (reply), false => full (attempt resend media)
    includeSelf: true,    // whether anti-delete also tracks messages from the bot itself / owner
    cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours default TTL for disk cache
    updatedAt: new Date().toISOString(),
  }

  const loadAntideleteConfig = () => {
    try {
      if (!fs.existsSync(CONFIG_FOLDER)) fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
      if (!fs.existsSync(ANTIDELETE_CONFIG_FILE)) {
        fs.writeFileSync(ANTIDELETE_CONFIG_FILE, JSON.stringify(DEFAULT_ANTIDELETE_CONFIG, null, 2), "utf8")
        return { ...DEFAULT_ANTIDELETE_CONFIG }
      }
      const raw = fs.readFileSync(ANTIDELETE_CONFIG_FILE, "utf8") || "{}"
      const parsed = JSON.parse(raw)
      return Object.assign({}, DEFAULT_ANTIDELETE_CONFIG, parsed)
    } catch (e) {
      console.warn("[ANTIDELETE] Failed to load config, using defaults:", e?.message || e)
      return { ...DEFAULT_ANTIDELETE_CONFIG }
    }
  }

  const saveAntideleteConfig = (cfg) => {
    try {
      if (!fs.existsSync(CONFIG_FOLDER)) fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
      const toSave = Object.assign({}, DEFAULT_ANTIDELETE_CONFIG, cfg, { updatedAt: new Date().toISOString() })
      fs.writeFileSync(ANTIDELETE_CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf8")
      return toSave
    } catch (e) {
      console.error("[ANTIDELETE] Failed to save config:", e?.message || e)
      return null
    }
  }

  // Ensure cache dir exists (best-effort)
  try {
    if (!fs.existsSync(ANTIDELETE_CACHE_DIR)) fs.mkdirSync(ANTIDELETE_CACHE_DIR, { recursive: true })
  } catch (e) {
    console.warn("[ANTIDELETE] Could not create cache dir:", e?.message || e)
  }

  // Best-effort cache stats (disk)
  const computeAntideleteCacheStats = () => {
    try {
      let files = []
      let bytes = 0
      if (fs.existsSync(ANTIDELETE_CACHE_DIR)) {
        files = fs.readdirSync(ANTIDELETE_CACHE_DIR).filter(Boolean)
        for (const f of files) {
          try {
            const st = fs.statSync(path.join(ANTIDELETE_CACHE_DIR, f))
            if (st && st.isFile()) bytes += st.size
          } catch (e) {}
        }
      }
      // If the codebase maintains an in-memory index (antiDeleteIndex), include its size
      let memEntries = 0
      try {
        if (typeof antiDeleteIndex !== "undefined" && antiDeleteIndex && typeof antiDeleteIndex.size === "number") memEntries = antiDeleteIndex.size
      } catch (e) {}
      return { files: files.length, bytes, memEntries }
    } catch (e) {
      return { files: 0, bytes: 0, memEntries: 0 }
    }
  }

  // Helper: pretty bytes
  const humanBytes = (b) => {
    if (!b && b !== 0) return "-"
    const units = ["B", "KB", "MB", "GB", "TB"]
    let i = 0
    let n = Number(b) || 0
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024
      i++
    }
    return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`
  }

  // Install command handler
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return
      if (!Array.isArray(messages) || messages.length === 0) return

      const msg = messages[0]
      if (!msg || !msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith?.("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = String(sender).split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isOwner = isUserOwner(senderNumber)
      const isFromBot = msg.key.fromMe === true

      // Respect access mode (private)
      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

      // Extract text-like content safely
      const messageType = Object.keys(msg.message)[0]
      const text =
        messageType === "conversation"
          ? msg.message.conversation
          : messageType === "extendedTextMessage"
            ? msg.message.extendedTextMessage.text
            : messageType === "imageMessage"
              ? msg.message.imageMessage.caption
              : ""

      if (!text || typeof text !== "string") return

      const args = text.trim().split(/\s+/)
      const cmd = (args[0] || "").toLowerCase()
      if (cmd !== ".antidelete") return

      // Only owners (at least isOwner) can operate these commands
      if (!isOwner) {
        await sock.sendMessage(from, { text: encodeUnicodeText("Hanya owner yang dapat menjalankan perintah .antidelete.") }, { quoted: msg })
        return
      }

      // Load current config
      let cfg = loadAntideleteConfig()

      const sub = (args[1] || "").toLowerCase()

      // Support toggles: on/text/full/off/status/self
      if (sub === "on" || sub === "text" || sub === "text-only") {
        // enable text-only mode
        if (cfg.enabled && cfg.textOnly) {
          await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete sudah aktif dalam mode TEXT-ONLY (bot akan membalas pesan yang dihapus).") }, { quoted: msg })
          return
        }
        cfg = saveAntideleteConfig({ enabled: true, textOnly: true, includeSelf: cfg.includeSelf })
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete DI-AKTIFKAN — MODE: TEXT-ONLY\n\n• Bot akan memulihkan pesan TEKS dengan cara membalas (reply) ke pesan yang dihapus.\n• Media yang dihapus TIDAK akan dikirim ulang pada mode ini (hemat penyimpanan).\n\nGunakan: .antidelete full → untuk mengaktifkan mode FULL (termasuk upaya resend media)\nGunakan: .antidelete status → untuk melihat status dan statistik cache.") }, { quoted: msg })
        console.log(`[ANTIDELETE] Enabled (text-only) by ${senderNumber}`)
        return
      }

      if (sub === "full" || sub === "media") {
        if (cfg.enabled && cfg.textOnly === false) {
          await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete sudah aktif dalam mode FULL (bot akan berusaha mengirim ulang media apabila tersedia salinan).") }, { quoted: msg })
          return
        }
        cfg = saveAntideleteConfig({ enabled: true, textOnly: false, includeSelf: cfg.includeSelf })
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete DI-AKTIFKAN — MODE: FULL\n\n• Bot akan mencoba mengirim ulang media yang dihapus apabila ada salinan yang tersimpan.\n• Perlu diingat: mode ini dapat menggunakan lebih banyak penyimpanan dan bandwidth.\n\nGunakan: .antidelete status → untuk melihat status & statistik cache.") }, { quoted: msg })
        console.log(`[ANTIDELETE] Enabled (full) by ${senderNumber}`)
        return
      }

      if (sub === "off" || sub === "disable") {
        if (!cfg.enabled) {
          await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete sudah nonaktif.") }, { quoted: msg })
          return
        }
        cfg = saveAntideleteConfig({ enabled: false })
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ Anti-delete DIMATIKAN\n\n• Bot tidak akan menampilkan pesan yang dihapus.\n• Data cache yang tersisa tetap ada sampai kadaluarsa atau dihapus manual.") }, { quoted: msg })
        console.log(`[ANTIDELETE] Disabled by ${senderNumber}`)
        return
      }

      // Toggle includeSelf: .antidelete self on|off|status
      if (sub === "self") {
        const param = (args[2] || "").toLowerCase()
        if (!param || (param !== "on" && param !== "off" && param !== "status")) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Format: .antidelete self <on|off|status>\nContoh: .antidelete self on — memungkinkan anti-delete juga untuk pesan diri sendiri (bot/owner).") }, { quoted: msg })
          return
        }
        if (param === "status") {
          await sock.sendMessage(from, { text: encodeUnicodeText(`Anti-delete apply-to-self: ${cfg.includeSelf ? "ENABLED" : "DISABLED"}`) }, { quoted: msg })
          return
        }
        const enableSelf = param === "on"
        cfg = saveAntideleteConfig({ includeSelf: enableSelf })
        await sock.sendMessage(from, { text: encodeUnicodeText(`✅ Anti-delete apply-to-self telah ${enableSelf ? "DIAKTIFKAN" : "DINONAKTIFKAN"}.`) }, { quoted: msg })
        console.log(`[ANTIDELETE] includeSelf set=${enableSelf} by ${senderNumber}`)
        return
      }

      // Status / help
      if (sub === "status" || sub === "" || sub === "help") {
        const stats = computeAntideleteCacheStats()
        const memEntries = stats.memEntries || 0
        const cacheFiles = stats.files
        const cacheSize = stats.bytes

        const lines = [
          "🔎 Anti-delete — STATUS & DIAGNOSTIK",
          "────────────────────────────────────",
          `Status       : ${cfg.enabled ? "ON" : "OFF"}`,
          `Mode         : ${cfg.textOnly ? "TEXT-ONLY (reply-only)" : "FULL (attempt resend media)"}`,
          `Apply to self: ${cfg.includeSelf ? "YES" : "NO"}`,
          `Cache (mem)  : ${memEntries} entri (jika tersedia)`,
          `Cache (disk) : ${cacheFiles} file  •  ${humanBytes(cacheSize)}`,
          `TTL cache    : ${Math.round((Number(cfg.cacheTtlMs || DEFAULT_ANTIDELETE_CONFIG.cacheTtlMs) / (1000 * 60 * 60)) * 100) / 100} jam`,
          "────────────────────────────────────",
          "Perintah singkat:",
          " • .antidelete on        — Aktifkan (TEXT-ONLY, reply)",
          " • .antidelete full      — Aktifkan (FULL, termasuk upaya resend media)",
          " • .antidelete off       — Matikan fitur",
          " • .antidelete status    — Lihat status & statistik cache",
          " • .antidelete self on/off — Terapkan juga pada pesan diri sendiri (bot/owner)",
          "────────────────────────────────���───",
          "Catatan:",
          " • Mode TEXT-ONLY lebih aman & hemat resource.",
          " • Mode FULL dapat meningkatkan penggunaan disk & bandwidth.",
        ]

        await sock.sendMessage(from, { text: encodeUnicodeText(lines.join("\n")) }, { quoted: msg })
        return
      }

      // Unknown subcommand -> help summary
      await sock.sendMessage(from, {
        text: encodeUnicodeText(
          "Format perintah .antidelete:\n" +
            "• .antidelete on        — Aktifkan (TEXT-ONLY, reply)\n" +
            "• .antidelete full      — Aktifkan (FULL, termasuk upaya resend media)\n" +
            "• .antidelete off       — Matikan fitur\n" +
            "• .antidelete status    — Lihat status & statistik cache\n" +
            "• .antidelete self on/off — Terapkan juga pada pesan diri sendiri (bot/owner)\n\n" +
            "Perintah hanya dapat digunakan oleh Owner (terdaftar di owners.json)."
        ),
      }, { quoted: msg })
    } catch (err) {
      console.error("[ANTIDELETE] Command handler error (improved):", err?.message || err)
      try {
        await sock.sendMessage(messages && messages[0] && messages[0].key ? messages[0].key.remoteJid : OWNER_JID, { text: encodeUnicodeText("⚠️ Terjadi kesalahan internal saat memproses .antidelete. Silakan cek log server.") })
      } catch (_) {}
    }
  })
  console.log("[ANTIDELETE] Improved command handler installed.")
} catch (e) {
  console.warn("[ANTIDELETE] Failed to install improved command handler:", e?.message || e)
}
  
// AUTO-REACT
{
  // Configurable emojis/timeouts
  const AUTO_REACT_INITIAL = "⏳" // show processing
  const AUTO_REACT_DONE = "✅"    // mark done when bot replies
  const AUTO_REACT_TIMEOUT_MS = 30_000 // fallback auto-complete timeout

  // Avoid double-install
  if (!sock.__autoReactInstalled) {
    sock.__autoReactInstalled = true

    // pending map: keyString -> { createdAt, tid }
    const pendingReacts = new Map()
    const makeKeyString = (remoteJid, id, participant) => `${remoteJid}|${id || ""}|${participant || ""}`

    // Safe send reaction with canonical payload and a fallback shape
    const safeSendReaction = async (remoteJid, messageKey, emoji) => {
      try {
        // canonical form most modern baileys accept
        await sock.sendMessage(remoteJid, { react: { text: emoji, key: messageKey } })
        return true
      } catch (err) {
        // fallback shape (some baileys versions expect a simpler key)
        try {
          const fallbackKey = {
            id: messageKey.id || (messageKey.key && messageKey.key.id) || "",
            remoteJid: messageKey.remoteJid || remoteJid,
            participant: messageKey.participant,
          }
          await sock.sendMessage(remoteJid, { react: { text: emoji, key: fallbackKey } })
          return true
        } catch (err2) {
          // do not throw — log and continue
          console.warn("[AUTO-REACT] Failed to send reaction:", err2?.message || err)
          return false
        }
      }
    }

    // Try to safely extract a stanzaId (quoted id) from various context shapes
    const extractQuotedInfo = (msgObj) => {
      try {
        const ctx =
          msgObj?.extendedTextMessage?.contextInfo ||
          msgObj?.contextInfo ||
          msgObj?.buttonsResponseMessage?.contextInfo ||
          msgObj?.templateButtonReplyMessage?.contextInfo ||
          null

        if (ctx?.stanzaId) return { id: ctx.stanzaId, participant: ctx.participant }
        if (ctx?.quotedMessage && ctx?.stanzaId) return { id: ctx.stanzaId, participant: ctx.participant }
        // Some shapes provide quotedMessage context differently
        if (ctx?.quotedMessage && ctx?.quotedMessage.key && ctx?.quotedMessage.key.id) {
          return { id: ctx.quotedMessage.key.id, participant: ctx.participant || ctx.quotedMessage.key.participant }
        }
        return null
      } catch (e) {
        return null
      }
    }

    // Incoming: place initial reaction and set a timeout to auto-complete
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify" || !Array.isArray(messages)) return

        for (const m of messages) {
          try {
            if (!m || !m.key || !m.message) continue
            // skip own messages and status
            if (m.key.fromMe) continue
            if (!m.key.remoteJid || m.key.remoteJid === "status@broadcast") continue

            // Skip protocol/system messages
            const mType = Object.keys(m.message)[0]
            if (["protocolMessage", "senderKeyDistributionMessage", "reactionMessage"].includes(mType)) continue

            // Build a reliable id to react to
            const stanzaId = m.key.id || (m.message?.key && m.message.key.id) || null
            if (!stanzaId) {
              // try to extract from nested quoted shapes (defensive)
              const alt = m.message?.extendedTextMessage?.contextInfo?.stanzaId
              if (alt) {
                // use alt
              } else {
                // if still no id, skip safely
                continue
              }
            }

            const key = { remoteJid: m.key.remoteJid, id: stanzaId, participant: m.key.participant }
            const keyStr = makeKeyString(key.remoteJid, key.id, key.participant)

            // If already pending, refresh its timeout (prevent many initial reactions)
            if (pendingReacts.has(keyStr)) {
              const info = pendingReacts.get(keyStr)
              try { clearTimeout(info.tid) } catch (_) {}
              const tid = setTimeout(async () => {
                try { await safeSendReaction(key.remoteJid, key, AUTO_REACT_DONE) } catch (_) {}
                pendingReacts.delete(keyStr)
              }, AUTO_REACT_TIMEOUT_MS)
              pendingReacts.set(keyStr, { createdAt: Date.now(), tid })
              continue
            }

            // Send initial "processing" reaction (best-effort)
            await safeSendReaction(key.remoteJid, key, AUTO_REACT_INITIAL)

            // Add to pending with auto-complete fallback
            const tid = setTimeout(async () => {
              try { await safeSendReaction(key.remoteJid, key, AUTO_REACT_DONE) } catch (_) {}
              pendingReacts.delete(keyStr)
            }, AUTO_REACT_TIMEOUT_MS)

            pendingReacts.set(keyStr, { createdAt: Date.now(), tid })
          } catch (inner) {
            console.warn("[AUTO-REACT] incoming handler error:", inner?.message || inner)
          }
        }
      } catch (e) {
        console.error("[AUTO-REACT] incoming upsert error:", e?.message || e)
      }
    })

    // Outgoing: when bot replies (quotes) to a user message, mark that user's message as done
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify" || !Array.isArray(messages)) return

        for (const m of messages) {
          try {
            if (!m || !m.key || !m.message) continue
            // only care about outgoing bot messages
            if (!m.key.fromMe) continue
            if (!m.key.remoteJid || m.key.remoteJid === "status@broadcast") continue

            // Try many shapes to find quoted stanzaId used by this outgoing message
            let quoted = null
            // primary: extendedTextMessage.contextInfo.stanzaId
            quoted = extractQuotedInfo(m.message) || extractQuotedInfo(m.message?.extendedTextMessage) || null

            // some messages expose context info under message[type].contextInfo
            if (!quoted) {
              const types = Object.keys(m.message || {})
              for (const t of types) {
                try {
                  const node = m.message[t]
                  quoted = extractQuotedInfo(node)
                  if (quoted) break
                } catch (e) {}
              }
            }

            if (!quoted || !quoted.id) continue

            const keyStr = makeKeyString(m.key.remoteJid, quoted.id, quoted.participant)

            if (pendingReacts.has(keyStr)) {
              const info = pendingReacts.get(keyStr)
              try { clearTimeout(info.tid) } catch (_) {}
              const originalMessageKey = { remoteJid: m.key.remoteJid, id: quoted.id, participant: quoted.participant, fromMe: false }
              await safeSendReaction(m.key.remoteJid, originalMessageKey, AUTO_REACT_DONE)
              pendingReacts.delete(keyStr)
            }
          } catch (inner) {
            console.warn("[AUTO-REACT] outgoing handler error:", inner?.message || inner)
          }
        }
      } catch (e) {
        console.error("[AUTO-REACT] outgoing upsert error:", e?.message || e)
      }
    })

    // Cleanup: remove very stale entries occasionally
    setInterval(() => {
      try {
        const now = Date.now()
        for (const [k, v] of pendingReacts) {
          if (!v || !v.createdAt) {
            try { clearTimeout(v.tid) } catch (_) {}
            pendingReacts.delete(k)
            continue
          }
          // if stuck for more than 4x timeout, remove
          if (now - v.createdAt > AUTO_REACT_TIMEOUT_MS * 4) {
            try { clearTimeout(v.tid) } catch (_) {}
            pendingReacts.delete(k)
          }
        }
      } catch (e) {
        // ignore cleanup errors
      }
    }, AUTO_REACT_TIMEOUT_MS * 2)

    console.log("[AUTO-REACT] Robust auto-react installed.")
  } else {
    console.log("[AUTO-REACT] Already installed; skipping duplicate installation.")
  }
}

  // ===============================
  // ADD-ON: Auto Block on Incoming Calls (Voice/Video)
  // - Pure add-on: does not modify any existing code or handlers.
  // - Respects owners defined in owners.json and OWNER_NUMBER.
  // ===============================
  try {
    if (sock && sock.ev && typeof sock.ev.on === "function") {
      sock.ev.on("call", async (callEvents) => {
        try {
          if (!Array.isArray(callEvents)) return
          for (const call of callEvents) {
            try {
              // Defensive extraction of status
              const status = call?.status || call?.call?.status || call?.callStatus || ""
              if (String(status).toLowerCase() !== "offer") continue

              // Defensive extraction of caller JID
              const callerRaw = call?.from || call?.call?.from || call?.participant || call?.id || (call?.key && call.key.remoteJid) || ""
              if (!callerRaw) continue
              const callerJid = String(callerRaw)

              // Extract pure number for owner checks
              const callerNumber = extractJidNumber(callerJid)
              const normalizedCaller = normalizeNumber(callerNumber)
              const normalizedMainOwner = normalizeNumber(OWNER_NUMBER)

              // Respect owners: loadOwners may return array of JIDs or numbers; normalize and compare
              const ownersList = loadOwners() || []
              const isCallerOwner =
                normalizedCaller === normalizedMainOwner ||
                ownersList.some((o) => {
                  const oNum = extractJidNumber(String(o))
                  return normalizeNumber(oNum) === normalizedCaller
                })

              if (isCallerOwner) {
                console.log(`[AUTO BLOCK CALL] Incoming call from owner ignored: ${callerJid}`)
                continue
              }

              console.log(`[AUTO BLOCK CALL] Incoming call detected from ${callerJid} - attempting reject & block`)

              // Attempt to reject the call (best-effort, swallow errors)
              try {
                const callId = call?.id || call?.call?.id || call?.callId || (call?.key && call.key.id) || null
                if (callId && typeof sock.rejectCall === "function") {
                  await sock.rejectCall(callId, callerJid).catch(() => {})
                } else if (typeof sock.rejectCall === "function") {
                  // fallback single-arg
                  await sock.rejectCall(callerJid).catch(() => {})
                } else {
                  // rejectCall not available; ignore
                }
              } catch (e) {
                console.warn("[AUTO BLOCK CALL] rejectCall failed:", e?.message || e)
              }

              // Optional: send a short warning message (best-effort)
              try {
                if (typeof sock.sendMessage === "function") {
                  await sock.sendMessage(callerJid, {
                    text: "❌ Bot tidak menerima panggilan. Nomor Anda akan diblokir secara otomatis.",
                  }).catch(() => {})
                }
              } catch (e) {
                console.warn("[AUTO BLOCK CALL] Warning message failed:", e?.message || e)
              }

              // Attempt to block the caller (best-effort)
              try {
                if (typeof sock.updateBlockStatus === "function") {
                  await sock.updateBlockStatus(callerJid, "block").catch(() => {})
                  console.log(`[AUTO BLOCK CALL] Blocked (updateBlockStatus): ${callerJid}`)
                } else if (typeof sock.updateBlocklist === "function") {
                  // Some implementations may provide alternate method; adapt defensively
                  try {
                    // updateBlocklist might accept array or single arg depending on version
                    await sock.updateBlocklist([callerJid], true).catch(() => {})
                  } catch (_) {
                    try {
                      await sock.updateBlocklist(callerJid, true).catch(() => {})
                    } catch (_) {}
                  }
                  console.log(`[AUTO BLOCK CALL] Blocked (updateBlocklist): ${callerJid}`)
                } else {
                  console.warn("[AUTO BLOCK CALL] No block method available on sock; blocking skipped.")
                }
              } catch (e) {
                console.warn("[AUTO BLOCK CALL] Blocking failed:", e?.message || e)
              }
            } catch (inner) {
              console.warn("[AUTO BLOCK CALL] per-call handling error:", inner?.message || inner)
            }
          }
        } catch (e) {
          console.error("[AUTO BLOCK CALL] call event handler error:", e?.message || e)
        }
      })

      console.log("[AUTO BLOCK CALL] Listener registered.")
    } else {
      console.warn("[AUTO BLOCK CALL] sock.ev.on not available; listener not registered.")
    }
  } catch (e) {
    console.error("[AUTO BLOCK CALL] Setup failed:", e?.message || e)
  }

  // =============================
  // CONNECTION HANDLER
  // =============================
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log("\nScan QR Code Sekarang:")
      qrcode.generate(qr, { small: true })
    }

    if (connection === "open") {
      console.log("H56 WhatsApp Bot Connected")
      console.log("Bot JID:", sock.user.id.split(":")[0])
      BOT_ACCESS_MODE = loadAccessMode() // Load access mode on startup
      console.log(`[ACCESS MODE] Current mode: ${BOT_ACCESS_MODE}`)}

// Di dalam: if (connection === "open") { ... }

// Hentikan interval lama bila ada, lalu mulai updater realtime (1s)
try {
  if (bioInterval) {
    try { bioInterval.stop?.(); } catch(_) { /* ignore */ }
    try { clearInterval(bioInterval); } catch(_) { /* ignore */ }
    bioInterval = null
  }

  // Mulai realtime about updater (menggunakan BOT_START_TIME dan formatRuntime yang ada)
  bioInterval = startRealtimeBioUpdater(sock, {
    getStartTime: () => BOT_START_TIME,
    formatRuntime,   // gunakan fungsi formatRuntime yang sudah ada di index.js
    intervalMs: 1000,
    logger,          // Pino logger yang sudah didefinisikan
  })

  if (!bioInterval) {
    console.warn("[BIO] Realtime bio updater tidak dimulai (sock.updateProfileStatus mungkin tidak tersedia).")
  } else {
    console.log("[BIO] Realtime bio updater aktif (1s interval).")
  }
} catch (e) {
  console.error("[BIO] Gagal memulai realtime bio updater:", e?.message || e)
}

    if (connection === "close") {
      // Clear bio interval on disconnect to avoid duplicate intervals on reconnect
      try {
        if (bioInterval) {
          clearInterval(bioInterval)
          bioInterval = null
          console.log("[BIO] Cleared bio interval due to connection close.")
        }
      } catch (e) {
        console.warn("[BIO] Failed to clear bio interval:", e?.message || e)
      }

      const reason = lastDisconnect?.error?.output?.statusCode

      if (reason === DisconnectReason.badSession) {
        console.log("Masalah Sesi: Bad Session File. Silakan hapus folder 'session' dan scan ulang.")
        process.exit()
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Koneksi ditutup, mencoba menyambung ulang...")
        startBot()
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Koneksi hilang dari server, menyambung ulang...")
        startBot()
      } else if (reason === DisconnectReason.loggedOut) {
        console.log("Perangkat Logged Out. Hapus folder session dan scan ulang.")
        process.exit()
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Restart Required, sedang restart...")
        startBot()
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection TimedOut, menyambung ulang...")
        startBot()
      } else {
        console.log(`DisconnectReason Unknown: ${reason}. Mencoba reconnect...`)
        startBot()
      }
    }
  })

  // =============================
  // MESSAGE HANDLER
  // =============================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return

      const msg = messages[0]
      if (!msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = sender.split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isOwner = isUserOwner(senderNumber)
      const isFromBot = msg.key.fromMe === true

      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) {
        console.log(`[ACCESS MODE] Message from ${senderNumber} ignored (private mode)`)
        return // Silently ignore without sending any response or notification
      }

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

      const getQuoted = () => {
        const context = msg.message?.extendedTextMessage?.contextInfo
        if (context?.quotedMessage) {
          return {
            key: { remoteJid: from, fromMe: false, id: context.stanzaId, participant: context.participant },
            message: context.quotedMessage,
          }
        }
        return msg
      }

      // ===============================
      // ACCESS MODE MANAGEMENT (NEW)
      // ===============================
      if (cmd === ".public") {
        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Hanya Owner Utama yang dapat mengubah mode akses bot.\n\nGunakan nomor owner yang terdaftar di sistem.",
              ),
            },
            { quoted: msg },
          )
          return
        }

        if (BOT_ACCESS_MODE === "public") {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Bot sudah dalam mode PUBLIC.\n\nBot akan merespons semua pengguna.") },
            { quoted: msg },
          )
          return
        }

        BOT_ACCESS_MODE = "public"
        saveAccessMode("public")
        await sock.sendMessage(
          from,
          {
            text: encodeUnicodeText(
              "Mode Akses Diubah ke PUBLIC\n\nBot sekarang akan merespons pesan dari semua pengguna.\n\nWaktu: " +
                new Date().toLocaleString("id-ID"),
            ),
          },
          { quoted: msg },
        )
        console.log(`[ACCESS MODE] Changed to PUBLIC by ${senderNumber}`)
        return
      }

      if (cmd === ".private") {
        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Hanya Owner Utama yang dapat mengubah mode akses bot.\n\nGunakan nomor owner yang terdaftar di sistem.",
              ),
            },
            { quoted: msg },
          )
          return
        }

        if (BOT_ACCESS_MODE === "private") {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText("Bot sudah dalam mode PRIVATE.\n\nBot hanya merespons Owner Utama."),
            },
            { quoted: msg },
          )
          return
        }

        BOT_ACCESS_MODE = "private"
        saveAccessMode("private")
        await sock.sendMessage(
          from,
          {
            text: encodeUnicodeText(
              "Mode Akses Diubah ke PRIVATE\n\nBot sekarang hanya merespons Owner Utama.\nSemua pesan dari pengguna lain akan diabaikan tanpa notifikasi.\n\nWaktu: " +
                new Date().toLocaleString("id-ID"),
            ),
          },
          { quoted: msg },
        )
        console.log(`[ACCESS MODE] Changed to PRIVATE by ${senderNumber}`)
        return
      }

      // ===============================
      // KICK ALL MEMBERS (UPGRADED)
      // ===============================
      if (cmd === ".kickall") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Hanya Owner Utama yang bisa menjalankan perintah .kickall.\n\nGunakan nomor owner yang terdaftar di sistem.",
              ),
            },
            { quoted: msg },
          )
          return
        }

        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Bot harus menjadi admin grup untuk mengeluarkan member.") },
            { quoted: msg },
          )
          return
        }

        try {
          // Fetch fresh group metadata to get full participant list
          const groupMetadata = await sock.groupMetadata(from)
          const botId = sock.user.lid || sock.user.id
          const botJidNumber = extractJidNumber(botId)
          const ownerNumber = normalizeNumber(OWNER_NUMBER)

          // Build owners set from loadOwners() and main owner
          const ownersRaw = loadOwners() || []
          const ownersSet = new Set()
          // include main owner
          ownersSet.add(ownerNumber)
          // include other owners normalized
          for (const o of ownersRaw) {
            try {
              const oNum = extractJidNumber(String(o))
              const norm = normalizeNumber(oNum)
              if (norm) ownersSet.add(norm)
            } catch (e) {}
          }

          // Build list of members to remove (exclude bot itself and any owner numbers)
          const allParticipants = groupMetadata.participants.map((p) => p.id)
          const removable = []
          for (const member of allParticipants) {
            const memberNumber = extractJidNumber(member)
            const normalizedMember = normalizeNumber(memberNumber)

            // Skip bot itself and owners
            if (normalizedMember === botJidNumber || ownersSet.has(normalizedMember)) {
              console.log(`[KICKALL] Skip member (bot/owner): ${member}`)
              continue
            }
            removable.push(member)
          }

          if (removable.length === 0) {
            await sock.sendMessage(from, { text: encodeUnicodeText("Tidak ada member yang dapat di-kick. Hanya owner dan bot yang ada di grup.") }, { quoted: msg })
            return
          }

          // Inform group that kickall will start (professional message)
          await sock.sendMessage(from, {
            text: encodeUnicodeText(`🔨 Mulai proses kickall oleh Owner Utama.\nTotal target: ${removable.length} member.\nProses akan berjalan sampai selesai. Mohon tunggu...`),
          }, { quoted: msg })

          // Helper: chunk array into batches
          const chunkArray = (arr, size) => {
            const chunks = []
            for (let i = 0; i < arr.length; i += size) {
              chunks.push(arr.slice(i, i + size))
            }
            return chunks
          }

          // To avoid hitting API limits, process in batches.
          // This does NOT limit total removals — it only batches them safely.
          const CHUNK_SIZE = 50 // safe batch size; adjust later if needed
          const chunks = chunkArray(removable, CHUNK_SIZE)

          let kickedCount = 0
          let failedMembers = []

          // Small helper to sleep
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

          // Process each chunk sequentially to be safe with rate limiting.
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            try {
              // Attempt batch removal
              await sock.groupParticipantsUpdate(from, chunk, "remove")
              kickedCount += chunk.length
              console.log(`[KICKALL] Chunk ${i + 1}/${chunks.length} removed: ${chunk.length}`)
            } catch (batchErr) {
              console.warn(`[KICKALL] Batch removal failed for chunk ${i + 1}: ${batchErr.message || batchErr}`)
              // Fallback: try per-member removal with retry
              for (const member of chunk) {
                let success = false
                let attempts = 0
                let lastError = null
                while (!success && attempts < 3) {
                  attempts++
                  try {
                    await sock.groupParticipantsUpdate(from, [member], "remove")
                    success = true
                    kickedCount++
                    console.log(`[KICKALL] Removed member ${member} (attempt ${attempts})`)
                    // Short delay between individual removals
                    await sleep(350)
                  } catch (indErr) {
                    lastError = indErr
                    console.warn(`[KICKALL] Failed to remove ${member} on attempt ${attempts}: ${indErr.message || indErr}`)
                    // backoff before retry
                    await sleep(500 * attempts)
                  }
                }
                if (!success) {
                  failedMembers.push({ member, reason: String(lastError?.message || lastError || "unknown") })
                }
              }
            }

            // Provide a lightweight progress message every few chunks to avoid spamming
            if ((i + 1) % 2 === 0 || i === chunks.length - 1) {
              try {
                await sock.sendMessage(from, { text: encodeUnicodeText(`Progress kickall: ${Math.min(kickedCount, removable.length)}/${removable.length} removed...`) })
              } catch (e) {
                console.warn("[KICKALL] Failed to send progress update:", e.message)
              }
            }

            // Respectful delay between chunks to reduce throttling risk
            if (i < chunks.length - 1) {
              await sleep(800)
            }
          }

          // Final result summary
          const failedCount = failedMembers.length
          const successCount = kickedCount
          let summary = `✅ Proses kickall selesai.\nBerhasil di-kick: ${successCount}\nGagal: ${failedCount}`

          if (failedCount > 0) {
            // include up to 10 failed entries for admin diagnostics
            const sample = failedMembers.slice(0, 10).map((f) => `- ${f.member.split("@")[0]}: ${f.reason}`).join("\n")
            summary += `\n\nContoh kegagalan:\n${sample}\n\nPeriksa log server untuk detail lebih lanjut.`
          }

          await sock.sendMessage(from, { text: encodeUnicodeText(summary) }, { quoted: msg })
          console.log(`[KICKALL] Completed. Success: ${successCount}, Failed: ${failedCount}`)
        } catch (e) {
          console.error("[KICKALL] Error:", e.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`Gagal menjalankan .kickall. Error: ${e.message}`) },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // SPAM MESSAGE
      // ===============================
      if (cmd === ".spam") {
        const count = Number.parseInt(args[1], 10)
        const spamText = args.slice(2).join(" ")

        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya Owner Utama yang bisa menggunakan perintah ini.") },
            { quoted: msg },
          )
          return
        }

        if (isNaN(count) || count <= 0) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText("Format: .spam <jumlah> <pesan>\nContoh: .spam 5 Halo semuanya"),
            },
            { quoted: msg },
          )
          return
        }

        if (!spamText) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText("Format: .spam <jumlah> <pesan>\nContoh: .spam 5 Halo semuanya"),
            },
            { quoted: msg },
          )
          return
        }

        for (let i = 0; i < count; i++) {
          await sock.sendMessage(from, { text: encodeUnicodeText(spamText) }, { quoted: msg })
        }

        await sock.sendMessage(from, { text: encodeUnicodeText("Pesan telah dikirim berulang kali.") }, { quoted: msg })
        return
      }
      
      // === START ADD: .spamreport (Only Owner Utama) ===
// Insert this block immediately AFTER the existing if (cmd === ".spam") { ... } return block
// Usage:
//   .spamreport <nomor_target> <jumlah_report>
//   .spamreport cancel    -> cancel running job initiated by the same owner (optional)
// Notes:
// - Only Owner Utama (OWNER_NUMBER) can run this command.
// - The command will attempt to call sock.reportJid(...) repetitively.
// - This implementation uses a small delay between reports to avoid tight loops and to be more robust.
if (cmd === ".spamreport") {
  try {
    // Permission: only Owner Utama
    if (!isMainOwner) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner Utama: hanya Owner Utama yang dapat menjalankan .spamreport.") }, { quoted: msg })
      return
    }

    // Initialize job store on sock if not present
    if (!sock.__spamReportJobs) sock.__spamReportJobs = new Map()

    const sub = (args[1] || "").trim().toLowerCase()
    // Support cancel/stop
    if (sub === "cancel" || sub === "stop") {
      // cancel all jobs initiated by this owner (keyed by owner number)
      const ownerKey = normalizeNumber(senderNumber) || extractJidNumber(senderNumber)
      const job = sock.__spamReportJobs.get(ownerKey)
      if (!job) {
        await sock.sendMessage(from, { text: encodeUnicodeText("Tidak ada proses .spamreport yang sedang berjalan.") }, { quoted: msg })
        return
      }
      // signal cancellation
      job.canceled = true
      // clear timers if any
      try { if (job.tid) clearInterval(job.tid) } catch (_) {}
      sock.__spamReportJobs.delete(ownerKey)
      await sock.sendMessage(from, { text: encodeUnicodeText("✅ Proses .spamreport dibatalkan.") }, { quoted: msg })
      console.log(`[SPAMREPORT] Canceled by owner ${senderNumber}`)
      return
    }

    const targetRaw = args[1] ? String(args[1]).trim() : ""
    const countRaw = args[2] ? String(args[2]).trim() : ""
    if (!targetRaw || !countRaw) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .spamreport <nomor_target> <jumlah_report>\nContoh: .spamreport 081234567890 100\nGunakan .spamreport cancel untuk menghentikan job Anda.") }, { quoted: msg })
      return
    }

    // Normalize target number to E.164-like '62...' as used across bot helpers
    const normalized = normalizeNumber(targetRaw)
    if (!normalized || normalized.length < 6) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Nomor target tidak valid. Pastikan format benar, misal: 081234567890 atau 6281234567890") }, { quoted: msg })
      return
    }

    // parse count (allow very large numbers per request — but be defensive re performance)
    let total = Number(countRaw.replace(/[^\d]/g, "")) || 0
    if (!Number.isFinite(total) || total <= 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Jumlah report tidak valid. Masukkan angka lebih besar dari 0.") }, { quoted: msg })
      return
    }

    // Build jid
    const targetJid = `${normalized}@s.whatsapp.net`

    // Check for existing job by same owner to avoid multiple concurrent identical jobs
    const ownerKey = normalizeNumber(senderNumber) || extractJidNumber(senderNumber)
    if (sock.__spamReportJobs.has(ownerKey)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Terdapat job .spamreport yang sedang berjalan untuk Anda. Gunakan .spamreport cancel untuk membatalkan terlebih dahulu.") }, { quoted: msg })
      return
    }

    // Best-effort check: report function availability
    const canReport = typeof sock.reportJid === "function"
    if (!canReport) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Fungsi report tidak tersedia di versi Baileys saat ini. Tidak dapat menjalankan .spamreport.") }, { quoted: msg })
      return
    }

    // Friendly confirmation & professional warning
    const previewText = `🔎 Target: +${normalized}\n🔢 Jumlah: ${total}\n\nProses akan berjalan dan akan ada pembaruan progres setiap 25 laporan atau setiap 10%.`
    await sock.sendMessage(from, { text: encodeUnicodeText(`⏳ Memulai proses .spamreport\n\n${previewText}\n\nUntuk membatalkan: .spamreport cancel`) }, { quoted: msg })

    // Job state
    const job = {
      targetJid,
      normalized,
      total,
      done: 0,
      failed: 0,
      errors: [],
      startedAt: Date.now(),
      canceled: false,
      lastProgressSentAt: 0,
      tid: null,
    }
    sock.__spamReportJobs.set(ownerKey, job)

    // Small helper: sleep (yield to event loop)
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

    // Responsible rate: small delay between each report to avoid tight loop.
    // Delay chosen to balance speed and not overwhelming the client/server.
    const PER_REPORT_DELAY_MS = 200 // 0.2s between requests; adjust if necessary

    // Progress: send update every PROGRESS_INTERVAL reports or percent-change
    const PROGRESS_INTERVAL = 25
    const sendProgress = async (force = false) => {
      try {
        const now = Date.now()
        if (!force && now - job.lastProgressSentAt < 2000) return // throttle progress messages
        // Compose progress text
        const pct = Math.round((job.done / job.total) * 100)
        const text = `📊 .spamreport progress\nTarget: +${job.normalized}\nDone: ${job.done}/${job.total} (${pct}%)\nFailed: ${job.failed}\nElapsed: ${formatRuntime(now - job.startedAt)}`
        await sock.sendMessage(from, { text: encodeUnicodeText(text) })
        job.lastProgressSentAt = now
      } catch (e) {
        // ignore progress send failures
      }
    }

    // Execute reporting loop
    (async () => {
      for (let i = 0; i < total; i++) {
        // check cancellation
        if (job.canceled) break

        try {
          // call reportJid with friendly reason
          // Some Baileys versions accept (jid, type, reason) — follow example usage
          await sock.reportJid(job.targetJid, "spam", `Mass report by owner ${extractJidNumber(sender)}`)
          job.done++
        } catch (err) {
          job.failed++
          // capture only limited error info
          try {
            const msgErr = err && err.message ? String(err.message).slice(0, 300) : String(err)
            job.errors.push(msgErr)
            console.warn(`[SPAMREPORT] report failed for ${job.targetJid} (#${i + 1}):`, msgErr)
          } catch (e) {
            job.errors.push("unknown")
          }
        }

        // Periodic progress send
        if ((i + 1) % PROGRESS_INTERVAL === 0) {
          await sendProgress()
        } else if ((i + 1) % Math.max(1, Math.floor(total / 20)) === 0) { // approx every 5%
          await sendProgress()
        }

        // small delay to avoid blocking/tight loops
        await sleep(PER_REPORT_DELAY_MS)
      }

      // Final cleanup: remove job
      sock.__spamReportJobs.delete(ownerKey)

      // Finalize: if canceled
      if (job.canceled) {
        await sock.sendMessage(from, { text: encodeUnicodeText(`⚠️ Proses .spamreport untuk +${job.normalized} dibatalkan.\nSelesai: ${job.done}/${job.total}, Gagal: ${job.failed}`) })
        console.log(`[SPAMREPORT] Job canceled by owner ${senderNumber} — done:${job.done}, failed:${job.failed}`)
        return
      }

      // Completed normally
      const summaryLines = [
        `✅ .spamreport selesai untuk +${job.normalized}`,
        `🔢 Total ter-proses: ${job.done + job.failed}`,
        `✔️ Berhasil: ${job.done}`,
        `❌ Gagal: ${job.failed}`,
        `⏱ Durasi: ${formatRuntime(Date.now() - job.startedAt)}`,
      ]
      if (job.failed > 0) {
        const sample = job.errors.slice(0, 6).map((e, idx) => `${idx + 1}. ${e}`).join("\n")
        summaryLines.push(`\nContoh kegagalan:\n${sample}\n(Cek log server untuk detail lebih lengkap)`)
      }
      await sock.sendMessage(from, { text: encodeUnicodeText(summaryLines.join("\n")) })
      console.log(`[SPAMREPORT] Completed by owner ${senderNumber} — done:${job.done}, failed:${job.failed}`)
    })()

    return
  } catch (err) {
    console.error("[SPAMREPORT] Handler error:", err?.message || err)
    try { await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal menjalankan .spamreport. Error: ${err?.message || err}`) }, { quoted: msg }) } catch (_) {}
    return
  }
}
// === END ADD: .spamreport ===

      // ===============================
      // MENU (IMPROVED PROFESSIONAL)
      // ===============================
      if (cmd === ".menu") {
        // Prefix info
        const prefixInfo = "Prefix: . (titik) — gunakan sebelum perintah, misal: .menu"

        await sock.sendMessage(
          from,
          {
            text: encodeUnicodeText(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
           🤖 H56 WHATSAPP BOT — MENU
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Halo @${senderNumber},

${prefixInfo}

📌 Sistem & Informasi
• .menu         — Tampilkan menu (ini)
• .dev          — Informasi developer & kontak
• .public/.private — Atur akses bot (Owner Utama)

🛠️ Owner / Grup (hak terbatas)
• .addowner <nomor>   — Tambah owner (Owner Utama)
• .addmember <nomor>  — Tambah member ke grup (Owner)
• .kick (reply/mention)      — Keluarkan member (Owner)
• .admin / .unadmin (reply)  — Promosikan / Copot admin (Owner)
• .kickall            — Keluarkan semua member (Owner Utama)
• .tagall <pesan>     — Tandai semua member (Owner Utama)
• .hidetag <pesan>    — Kirim pesan + mention semua tanpa men-display tags (Owner)
• .setpp (Owner Utama)       — Set foto profil bot (reply gambar)
• .setppgrup (Owner Bot)     — Set foto grup (reply gambar)
• .closegroup / .opengroup   — Lock / Unlock group (admin)
• .deletemsg (reply)  — Hapus pesan yang direply (Owner, bot admin)
• .block <reply|@nomor|nomor>   — Blokir nomor (HANYA Owner Utama)
• .unblock <reply|@nomor|nomor> — Buka blokir nomor (HANYA Owner Utama)

🎨 Stiker & Media
• .stiker (reply gambar)    — Ubah gambar menjadi stiker (format: JPEG/PNG/WEBP)
• .qrcode <url/teks>        — Generate QR Code (dikirim sebagai gambar)
• .audiotovn (reply audio)  — Konversi audio menjadi Voice Note (OGG/OPUS) — file disimpan: /HASYIM56/audio
• .mediafire <url>          — Download file MediaFire — file disimpan: /HASYIM56/mediafire
• .viewonce (reply pesan)   — Ambil gambar, video, voice note yang disetel view-once dan kirim ulang sebagai gambar biasa

📥 Downloading & Social
• .ttdownload <url>         — Download video TikTok (jika tersedia)
• .ttsearch <username>      — Cari pengguna TikTok
• .ytmp4 <url> <resolusi>   — Download YouTube -> MP4 (file disimpan: /HASYIM56/youtube)
• .ytmp3 <url> <bitrate>    — Download audio MP3 YouTube (khusus music).

🌐 Terjemahan
• .translate <kode> <teks>  — Terjemahkan teks (contoh: .translate en halo)
• .translate list           — Daftar bahasa yang didukung

🔒 Fitur Lain
• .fwd on / .fwd off        — Forward Many Times Mode (Owner Utama)
• .spam <n> <pesan>         — Kirim pesan berulang (Owner Utama)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Catatan:
  - Semua file media besar disimpan di folder permanen /HASYIM56/*
  - Pastikan bot memiliki izin admin untuk perintah grup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Powered by HASYIM56 • Maintain: ${DEV_NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`),
            mentions: [sender],
          },
          { quoted: msg },
        )
        return
      }
      
      
if (cmd === ".author") {
  try {
    const bodyText = [
      "👤 *INFORMASI DEVELOPER*",
      "",
      "*Nama*   : HASYIM56",
      "*Peran*  : Developer & Modder",
      "*Project*: H56 WhatsApp Bot",
      "",
      "Kontak & platform resmi:",
      "• YouTube  : https://youtube.com/@HASYIM56",
      "• Instagram: https://instagram.com/hasyim56_modder",
      "• GitHub   : https://github.com/HASYIM56",
      "",
      "Silakan gunakan tombol di bawah untuk membuka platform resmi author.",
    ].join("\n")

    const footerText = "© HASYIM56 Development — Maintain: @HASYIM56"

    // Template buttons (URL buttons) — WhatsApp/Baileys compatible
    const templateMessage = {
      text: encodeUnicodeText(bodyText),
      footer: footerText,
      templateButtons: [
        {
          index: 1,
          urlButton: {
            displayText: "🎥 YouTube @HASYIM56",
            url: "https://youtube.com/@HASYIM56",
          },
        },
        {
          index: 2,
          urlButton: {
            displayText: "📸 Instagram @hasyim56_modder",
            url: "https://instagram.com/hasyim56_modder",
          },
        },
        {
          index: 3,
          urlButton: {
            displayText: "💻 GitHub HASYIM56",
            url: "https://github.com/HASYIM56",
          },
        },
        {
          index: 4,
          urlButton: {
            displayText: "👎 Beri Kritik / Feedback",
            url: "[MASUKKAN_LINK_FEEDBACK_DISINI]",
          },
        },
      ],
    }

    // Send template message; quoted: preserve context & UX
    await sock.sendMessage(from, templateMessage, { quoted: msg })
  } catch (err) {
    console.error("[AUTHOR] Handler error:", err?.message || err)
    // Fallback: send plain text (keamanan agar pengguna tetap mendapatkan info)
    try {
      await sock.sendMessage(
        from,
        {
          text: encodeUnicodeText(
            "👤 INFORMASI DEVELOPER\n\nNama: HASYIM56\nPeran: Developer & Modder\nProject: H56 WhatsApp Bot\n\nLinks:\n• YouTube: https://youtube.com/@HASYIM56\n• Instagram: https://instagram.com/hasyim56_modder\n• GitHub: https://github.com/HASYIM56\n• Feedback: [MASUKKAN_LINK_FEEDBACK_DISINI]\n\n© HASYIM56 Development"
          ),
        },
        { quoted: msg },
      )
    } catch (_) {}
  }
  return
}

// GITHUB SEARCH - .githubsearch
// Usage: .githubsearch <username>
if (cmd === ".githubsearch") {
  try {
    const usernameArg = args.slice(1).join(" ").trim()
    // Pass helpers to handler
    await githubSearchHandler(sock, msg, usernameArg, { encodeUnicodeText, logger })
  } catch (err) {
    console.error("[GITHUB CMD] Error:", err?.message || err)
    try {
      await sock.sendMessage(from, { text: encodeUnicodeText("⚠️ Terjadi kesalahan saat memproses perintah .githubsearch.") }, { quoted: msg })
    } catch (_) {}
  }
  return
}

      // ===============================
      // DEV INFO
      // ===============================
      if (cmd === ".dev") {
        await sock.sendMessage(
          from,
          {
            text: encodeUnicodeText(`
========================================
              DEVELOPER
========================================

WhatsApp:
- wa.me/${DEV_NUMBER}

Sosial:
- YouTube : https://youtube.com/${DEV_NAME}
- GitHub  : https://github.com/${DEV_NAME}

Developer:
- ${DEV_NAME}
- +${DEV_NUMBER}

========================================
Untuk kolaborasi atau dukungan, hubungi contact di atas.
========================================
`),
            mentions: [`${DEV_NUMBER}@s.whatsapp.net`],
          },
          { quoted: msg },
        )
        return
      }

      // TRANSLATE

if (cmd === ".translate") {
  try {
    // If user asks for list, prefer built-in supportedLanguages from h56-translator
    if (args[1] === "list") {
      try {
        const langs = Array.isArray(h56SupportedLanguages) && h56SupportedLanguages.length > 0
          ? h56SupportedLanguages.map(l => `${l.code} — ${l.name}`).join("\n")
          : getLanguageList() // fallback to existing mapping if package list unavailable

        await sock.sendMessage(from, { text: encodeUnicodeText(`Daftar Bahasa yang Didukung:\n\n${langs}`) }, { quoted: msg })
      } catch (e) {
        // fallback friendly message
        await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengambil daftar bahasa. Coba lagi nanti atau gunakan .translate list sekali lagi.") }, { quoted: msg })
      }
      return
    }

    // Validate args
    if (args.length < 3) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .translate <kode_target> <teks>\nContoh: .translate en Halo dunia\nGunakan .translate list untuk melihat kode bahasa yang tersedia.") }, { quoted: msg })
      return
    }

    const target = args[1].toLowerCase().trim()
    const textToTranslate = args.slice(2).join(" ").trim()

    if (!textToTranslate) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Teks tidak boleh kosong. Gunakan: .translate <kode_target> <teks>") }, { quoted: msg })
      return
    }

    // Validate target language against supported list (best-effort)
    let isSupported = false
    try {
      if (Array.isArray(h56SupportedLanguages)) {
        isSupported = h56SupportedLanguages.some((l) => String(l.code).toLowerCase() === String(target).toLowerCase())
      }
      // fallback check against our TRANSLATE_LANGUAGES map
      if (!isSupported && TRANSLATE_LANGUAGES[target]) isSupported = true
    } catch (e) {
      isSupported = true // be permissive if validation fails unexpectedly
    }

    if (!isSupported) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`Kode bahasa '${target}' tidak dikenal. Gunakan .translate list untuk melihat kode yang didukung.`) }, { quoted: msg })
      return
    }

    // Inform user we're translating
    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Sedang menerjemahkan, mohon tunggu...") }, { quoted: msg })

    // Call h56-translator
    let result = null
    try {
      // Module example: translate(text, targetLang) -> returns TranslationResult-like object
      result = await h56Translate(textToTranslate, target)
    } catch (e) {
      // network / library error
      console.error("[TRANSLATE] h56-translator threw:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Terjadi kesalahan saat menerjemahkan: ${e?.message || "unknown error"}`) }, { quoted: msg })
      return
    }

    // Normalise result structure (handle both new and error shapes)
    if (!result) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Tidak menerima respons dari layanan penerjemah. Coba lagi nanti.") }, { quoted: msg })
      return
    }

    // If serviceStatus present, honor it
    const svc = result.serviceStatus || (result.raw && result.raw.serviceStatus) || null

    if (svc === "error") {
      const errObj = result.error || (result.raw && result.raw.error) || {}
      const code = errObj.code || "error"
      const message = errObj.message || "Layanan penerjemah mengembalikan error."
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Translate service error: (${code}) ${message}`) }, { quoted: msg })
      return
    }

    // If translate returned string or object: try to extract translatedText
    let translatedText = ""
    let sourceLang = result.sourceLang || (result.raw && result.raw.sourceLang) || ""
    let targetLang = result.targetLang || target

    if (typeof result === "string") {
      translatedText = result
    } else if (result.translatedText) {
      translatedText = result.translatedText
    } else if (result.data && result.data.translatedText) {
      translatedText = result.data.translatedText
    } else if (result.translation) {
      translatedText = result.translation
    } else {
      // fallback: try to use result.toString()
      translatedText = String(result || "")
    }

    if (!translatedText) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal mendapatkan teks terjemahan dari layanan. Coba lagi nanti.") }, { quoted: msg })
      return
    }

    // Compose professional response
    let sourceDisplay = sourceLang || "auto"
    try {
      // Try to find display name from supported list
      if (!sourceDisplay && Array.isArray(h56SupportedLanguages)) {
        // noop
      }
      const sourceName = (Array.isArray(h56SupportedLanguages) && h56SupportedLanguages.find(l => l.code === sourceLang)?.name) || TRANSLATE_LANGUAGES[sourceLang] || sourceDisplay
      const targetName = (Array.isArray(h56SupportedLanguages) && h56SupportedLanguages.find(l => l.code === targetLang)?.name) || TRANSLATE_LANGUAGES[targetLang] || targetLang

      const out = `🌐 Translate Result\nFrom: ${sourceLang || "auto"} ${sourceName ? `— ${sourceName}` : ""}\nTo: ${targetLang} ${targetName ? `— ${targetName}` : ""}\n\n${translatedText}`

      await sock.sendMessage(from, { text: encodeUnicodeText(out) }, { quoted: msg })
      return
    } catch (e) {
      // fallback simple reply
      await sock.sendMessage(from, { text: encodeUnicodeText(`${translatedText}\n\n(${sourceLang || "auto"} → ${targetLang})`) }, { quoted: msg })
      return
    }
  } catch (err) {
    console.error("[TRANSLATE HANDLER] Unexpected error:", err?.message || err)
    try {
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Terjadi kesalahan pada perintah translate: ${err?.message || err}`) }, { quoted: msg })
    } catch (_) {}
    return
  }
}

      // ===============================
      // ADD OWNER
      // ===============================
      if (cmd === ".addowner") {
        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya Owner Utama yang bisa menambah owner.") },
            { quoted: msg },
          )
          return
        }

        if (args.length < 2) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Format: .addowner <nomor>\nContoh: .addowner 6281234567890 atau .addowner 081234567890",
              ),
            },
            { quoted: msg },
          )
          return
        }

        const newOwner = normalizeNumber(args[1])

        if (newOwner.length < 10 || !newOwner.startsWith("62")) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Nomor tidak valid. Pastikan format nomor benar.") },
            { quoted: msg },
          )
          return
        }

        // Save as full JID format
        const newOwnerJid = `${newOwner}@s.whatsapp.net`

        const owners = loadOwners()
        if (owners.some((o) => normalizeNumber(o) === newOwner)) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Nomor ini sudah menjadi owner.") }, { quoted: msg })
          return
        }

        owners.push(newOwnerJid)
        saveOwners(owners)
        await sock.sendMessage(
          from,
          { text: encodeUnicodeText(`Nomor +${newOwner} berhasil ditambahkan sebagai owner.`) },
          { quoted: msg },
        )
        return
      }

      // ===============================
      // BLOCK / UNBLOCK (NEW) - only Owner Utama
      if (cmd === ".block" || cmd === ".unblock") {
        const action = cmd === ".block" ? "block" : "unblock"
        // Only main owner allowed
        if (!isMainOwner) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner Utama: hanya Owner Utama yang dapat menggunakan perintah ini.") }, { quoted: msg })
          return
        }

        // Determine target JID: prefer mentioned JID, then quoted participant, then arg number
        const context = msg.message?.extendedTextMessage?.contextInfo
        const mentioned = context?.mentionedJid || []
        let targetJid = null

        if (mentioned && mentioned.length > 0) {
          targetJid = mentioned[0]
        } else if (context?.participant) {
          // If command is replying to a message, context.participant may be present
          targetJid = context.participant
        } else if (args[1]) {
          // Try parse number arg
          const possible = args[1].trim()
          const normalized = normalizeNumber(possible)
          if (normalized && normalized.length > 5) {
            targetJid = `${normalized}@s.whatsapp.net`
          }
        }

        if (!targetJid) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Format: ." + action + " <reply|@nomor|nomor>\nContoh: .block 6281234567890 atau reply pesan user dengan caption .block") }, { quoted: msg })
          return
        }

        try {
          // Try updateBlockStatus if available
          if (typeof sock.updateBlockStatus === "function") {
            await sock.updateBlockStatus(targetJid, action)
          } else if (typeof sock.updateBlocklist === "function") {
            // try array form first
            try {
              await sock.updateBlocklist([targetJid], action === "block")
            } catch (e) {
              try {
                // fallback single-arg toggle
                await sock.updateBlocklist(targetJid, action === "block")
              } catch (e2) {
                throw e2
              }
            }
          } else {
            throw new Error("Fitur block/unblock tidak didukung di versi Baileys ini.")
          }

          const readable = action === "block" ? "diblokir" : "dibuka blokirnya"
          await sock.sendMessage(from, { text: encodeUnicodeText(`Nomor ${targetJid.split("@")[0]} berhasil ${readable} oleh Owner Utama.`) }, { quoted: msg })
          console.log(`[BLOCK] ${action} performed by ${senderNumber} on ${targetJid}`)
        } catch (e) {
          console.error(`[BLOCK] Failed to ${action} ${targetJid}:`, e?.message || e)
          await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal melakukan ${action} pada nomor ${targetJid.split("@")[0]}. Error: ${e?.message || e}`) }, { quoted: msg })
        }
        return
      }

      // ===============================
      // KICK MEMBER
      // ===============================
      if (cmd === ".kick") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya owner bot yang bisa mengeluarkan member.") },
            { quoted: msg },
          )
          return
        }

        const quotedMsg = getQuoted()
        const mentionedJid = quotedMsg.message?.extendedTextMessage?.contextInfo?.mentionedJid
        const targetJid = mentionedJid ? mentionedJid[0] : null

        if (!targetJid) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Reply pesan member atau mention member yang ingin di-kick.") },
            { quoted: msg },
          )
          return
        }

        try {
          await sock.groupParticipantsUpdate(from, [targetJid], "remove")
          const targetNumber = targetJid.split("@")[0]
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`@${targetNumber} telah dikeluarkan dari grup.`), mentions: [targetJid] },
            { quoted: msg },
          )
        } catch (e) {
          console.error("[KICK] Error:", e.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Gagal mengeluarkan member. Pastikan bot adalah admin grup.") },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // PROMOTE TO ADMIN - .admin (NEW)
      // Only owners (as per owners.json) can use this
      // Usage: reply to a member's message or mention them in the command
      // ===============================
      if (cmd === ".admin") {
        if (!isGroup) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") }, { quoted: msg })
          return
        }

        if (!isOwner) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Hanya owner yang dapat menggunakan perintah ini.") }, { quoted: msg })
          return
        }

        const quotedMsg = getQuoted()
        // Try to read mentioned JIDs or fallback to the quoted participant
        const mentioned = quotedMsg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        let targetJids = []
        if (mentioned.length > 0) {
          targetJids = mentioned
        } else if (quotedMsg?.key?.participant) {
          targetJids = [quotedMsg.key.participant]
        }

        if (!targetJids || targetJids.length === 0) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Tandai atau reply member yang ingin dijadikan admin.\nContoh: .admin @user") }, { quoted: msg })
          return
        }

        // Bot must be admin to promote others
        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Bot harus menjadi admin grup untuk mempromosikan member.") }, { quoted: msg })
          return
        }

        try {
          await sock.groupParticipantsUpdate(from, targetJids, "promote")
          await sock.sendMessage(from, { text: encodeUnicodeText("Berhasil mempromosikan member menjadi admin ✅"), mentions: targetJids }, { quoted: msg })
          console.log(`[ADMIN] Promoted: ${targetJids.join(", ")} in ${from} by ${senderNumber}`)
        } catch (e) {
          console.error("[ADMIN] Error:", e.message)
          await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal mempromosikan admin. Error: ${e.message}`) }, { quoted: msg })
        }
        return
      }

      // ===============================
      // DEMOTE ADMIN - .unadmin (NEW)
      // Only owners (as per owners.json) can use this
      // Usage: reply to an admin's message or mention them in the command
      // ===============================
      if (cmd === ".unadmin") {
        if (!isGroup) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") }, { quoted: msg })
          return
        }

        if (!isOwner) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Hanya owner yang dapat menggunakan perintah ini.") }, { quoted: msg })
          return
        }

        const quotedMsg = getQuoted()
        const mentioned = quotedMsg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        let targetJids = []
        if (mentioned.length > 0) {
          targetJids = mentioned
        } else if (quotedMsg?.key?.participant) {
          targetJids = [quotedMsg.key.participant]
        }

        if (!targetJids || targetJids.length === 0) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Tandai atau reply admin yang ingin dicopot hak adminnya.\nContoh: .unadmin @user") }, { quoted: msg })
          return
        }

        // Bot must be admin to demote others
        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Bot harus menjadi admin grup untuk mencopot hak admin.") }, { quoted: msg })
          return
        }

        try {
          await sock.groupParticipantsUpdate(from, targetJids, "demote")
          await sock.sendMessage(from, { text: encodeUnicodeText("Berhasil mencopot hak admin ✅"), mentions: targetJids }, { quoted: msg })
          console.log(`[UNADMIN] Demoted: ${targetJids.join(", ")} in ${from} by ${senderNumber}`)
        } catch (e) {
          console.error("[UNADMIN] Error:", e.message)
          await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal mencopot hak admin. Error: ${e.message}`) }, { quoted: msg })
        }
        return
      }

      // ===============================
      // SET BOT PROFILE PICTURE
      // ===============================
      if (cmd === ".setpp") {
        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Hanya Owner Utama yang bisa mengubah profile picture bot.\n\nGunakan nomor owner yang terdaftar di sistem.",
              ),
            },
            { quoted: msg },
          )
          return
        }

        const quotedMsg = getQuoted()
        const img = quotedMsg.message?.imageMessage

        if (!img) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Format salah!\n\nCara penggunaan:\n1. Kirim atau reply gambar\n2. Berikan caption: .setpp",
              ),
            },
            { quoted: msg },
          )
          return
        }

        try {
          const imageSize = img.fileLength || 0
          const imageMime = img.mimetype || "image/jpeg"

          if (imageSize > MAX_IMAGE_SIZE) {
            await sock.sendMessage(
              from,
              {
                text: `Ukuran gambar terlalu besar. Max 5MB, gambar Anda ${(imageSize / 1024 / 1024).toFixed(2)}MB`,
              },
              { quoted: msg },
            )
            return
          }

          if (!ALLOWED_MIME.includes(imageMime)) {
            await sock.sendMessage(
              from,
              { text: encodeUnicodeText("Format gambar tidak didukung. Gunakan JPEG, PNG, atau WEBP.") },
              { quoted: msg },
            )
            return
          }

          const stream = await downloadContentFromMessage(img, "image")
          let buffer = Buffer.from([])
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

          await sock.updateProfilePicture(sock.user.id, buffer)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Foto profil bot berhasil diperbarui.") },
            { quoted: msg },
          )
        } catch (e) {
          console.error("SetPP Error:", e.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`Gagal update foto profil bot. Error: ${e.message}`) },
            { quoted: msg },
          )
        }
        return
      }

/*
  Usage (same as before):
  - Send an image with caption: .setpppanjang
  - Or reply to an image with caption: .setpppanjang

  Only Owner Utama (isMainOwner) can run this command.
*/

if (cmd === ".setpppanjang") {
  try {
    // Owner check
    if (!isMainOwner) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner Utama: hanya Owner Utama yang dapat menggunakan perintah .setpppanjang.") }, { quoted: msg })
      return
    }

    const quotedMsg = getQuoted()
    // Prefer replied image, otherwise image with caption
    const imgNode = (quotedMsg && quotedMsg.message && quotedMsg.message.imageMessage) ? quotedMsg.message.imageMessage : (msg.message.imageMessage ? msg.message.imageMessage : null)

    if (!imgNode) {
      await sock.sendMessage(from, { text: encodeUnicodeText(
        "Format salah!\n\nCara penggunaan:\n1. Kirim gambar atau reply gambar\n2. Berikan caption: .setpppanjang\n\nPerintah ini akan mengunggah gambar asli (tanpa canvas) ke profil sehingga gambar panjang dapat terlihat penuh saat dilihat."
      ) }, { quoted: msg })
      return
    }

    // Inform owner
    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Mengunduh gambar dan menyiapkan profil panjang (tanpa canvas). Mohon tunggu...") }, { quoted: msg })

    // Size guard for source (avoid processing ultra-large files)
    const origSize = Number(imgNode.fileLength || 0)
    const MAX_ACCEPT_SOURCE = 30 * 1024 * 1024 // 30MB hard limit for incoming stream
    if (origSize > 0 && origSize > MAX_ACCEPT_SOURCE) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`Ukuran file sumber terlalu besar untuk diproses (batas ${Math.round(MAX_ACCEPT_SOURCE/1024/1024)} MB). Silakan gunakan gambar yang lebih kecil atau kompres terlebih dahulu.`) }, { quoted: msg })
      return
    }

    // Download image stream robustly
    const s = await downloadContentFromMessage(imgNode, "image")
    let srcBuffer = Buffer.from([])
    for await (const chunk of s) {
      srcBuffer = Buffer.concat([srcBuffer, chunk])
      // safety: abort if streaming too large
      if (srcBuffer.length > MAX_ACCEPT_SOURCE) break
    }

    if (!srcBuffer || srcBuffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengunduh gambar. Silakan coba lagi.") }, { quoted: msg })
      return
    }

    // Processing strategy:
    // - Preserve entire image (no padding/canvas)
    // - Resize if too large (max dimension limit) to keep memory & upload reasonable
    // - Encode to JPEG (widely compatible) with progressive quality fallback until <= PROFILE_MAX
    // - Try direct upload of processedBuffer. If updateProfilePicture fails, attempt a slightly
    //   more compatible fallback (smaller quality / convert to PNG) before reporting failure.

    const PROFILE_MAX = 5 * 1024 * 1024 // 5MB final target (WhatsApp profile size)
    const MAX_DIM = 4096 // maximum width/height to avoid huge images
    const START_QUALITY = 92
    const MIN_QUALITY = 36

    let processedBuffer = null
    try {
      // Use sharp to respect orientation and preserve aspect ratio
      let img = sharp(srcBuffer, { animated: false }).rotate() // rotate according to EXIF

      const meta = await img.metadata()
      const origW = meta.width || 1024
      const origH = meta.height || 1024

      // Calculate desired resize dimensions (fit inside MAX_DIM while preserving ratio)
      const needResize = origW > MAX_DIM || origH > MAX_DIM
      if (needResize) {
        img = img.resize({
          width: origW > origH ? MAX_DIM : null,
          height: origH >= origW ? MAX_DIM : null,
          fit: "inside",
          withoutEnlargement: true,
        })
      }

      // Heuristic: if extremely tall (or wide), ensure we don't create enormous images by limiting the longer side
      // (we already applied MAX_DIM). Now create JPEG and reduce quality progressively if needed.
      let quality = START_QUALITY
      processedBuffer = await img.jpeg({ quality, mozjpeg: true }).toBuffer()

      // If result too large, progressively reduce quality (but do NOT add padding/canvas)
      while (processedBuffer.length > PROFILE_MAX && quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, Math.floor(quality * 0.8)) // reduce by 20% each iteration
        processedBuffer = await img.jpeg({ quality, mozjpeg: true }).toBuffer()
        console.log(`[SETPPPANJANG] Reduced quality -> ${quality}, size ${(processedBuffer.length/1024/1024).toFixed(2)} MB`)
      }

      // As an extra fallback, if still too large, try WebP with quality fallback (often smaller)
      if (processedBuffer.length > PROFILE_MAX) {
        let webpQ = Math.min(90, Math.max(50, quality))
        let webpBuf = await img.webp({ quality: webpQ }).toBuffer()
        // reduce webp quality if still large
        while (webpBuf.length > PROFILE_MAX && webpQ > 30) {
          webpQ = Math.max(30, Math.floor(webpQ * 0.85))
          webpBuf = await img.webp({ quality: webpQ }).toBuffer()
          console.log(`[SETPPPANJANG] WebP fallback quality=${webpQ}, size ${(webpBuf.length/1024/1024).toFixed(2)} MB`)
        }
        // Prefer WebP if smaller than JPEG and within limit
        if (webpBuf.length <= PROFILE_MAX && webpBuf.length < processedBuffer.length) {
          processedBuffer = webpBuf
          console.log("[SETPPPANJANG] Using WebP fallback for smaller size")
        }
      }
    } catch (procErr) {
      console.error("[SETPPPANJANG] Error during image processing (no-canvas flow):", procErr?.message || procErr)
      // fallback to using original buffer (attempt upload), but warn owner
      processedBuffer = srcBuffer
      await sock.sendMessage(from, { text: encodeUnicodeText("⚠️ Warning: Terjadi masalah saat memproses gambar. Bot akan mencoba mengunggah gambar asli tanpa modifikasi.") }, { quoted: msg })
    }

    if (!processedBuffer || processedBuffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal menyiapkan gambar profil. Silakan coba dengan gambar lain.") }, { quoted: msg })
      return
    }

    // Final safety check: if processedBuffer still huge, attempt a final aggressive recompress
    if (processedBuffer.length > PROFILE_MAX) {
      try {
        const aggressiveQ = 40
        const aggressiveBuf = await sharp(processedBuffer).jpeg({ quality: aggressiveQ, mozjpeg: true }).toBuffer()
        if (aggressiveBuf && aggressiveBuf.length < processedBuffer.length) {
          processedBuffer = aggressiveBuf
          console.log(`[SETPPPANJANG] Aggressive recompress applied (q=${aggressiveQ}) -> ${(processedBuffer.length/1024/1024).toFixed(2)} MB`)
        }
      } catch (e) {
        console.warn("[SETPPPANJANG] Aggressive recompress failed (ignored):", e?.message || e)
      }
    }

    if (processedBuffer.length > PROFILE_MAX) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal: hasil gambar masih terlalu besar (${(processedBuffer.length/1024/1024).toFixed(2)} MB). Silakan gunakan gambar dengan resolusi lebih kecil atau kompres terlebih dahulu.`) }, { quoted: msg })
      return
    }

    // Attempt to set profile picture (primary attempt)
    try {
      await sock.updateProfilePicture(sock.user.id, processedBuffer)
      await sock.sendMessage(from, { text: encodeUnicodeText("✅ Foto profil panjang berhasil diperbarui tanpa canvas. Klik profil untuk melihat gambar penuh.") }, { quoted: msg })
      console.log(`[SETPPPANJANG] updateProfilePicture succeeded by ${extractJidNumber(sender)} — size ${(processedBuffer.length/1024).toFixed(0)} KB`)
      return
    } catch (upErr) {
      console.warn("[SETPPPANJANG] Primary updateProfilePicture failed:", upErr?.message || upErr)
      // Try fallback strategies:
      // 1) Try with original srcBuffer if different
      try {
        if (srcBuffer && srcBuffer.length > 0 && srcBuffer !== processedBuffer) {
          await sock.updateProfilePicture(sock.user.id, srcBuffer)
          await sock.sendMessage(from, { text: encodeUnicodeText("✅ Foto profil berhasil diperbarui menggunakan file asli sebagai fallback (tanpa canvas).") }, { quoted: msg })
          console.log("[SETPPPANJANG] Fallback upload of original buffer succeeded.")
          return
        }
      } catch (fb1Err) {
        console.warn("[SETPPPANJANG] Fallback original upload failed:", fb1Err?.message || fb1Err)
      }

      // 2) Try an additional fallback: small JPEG aggressive compression
      try {
        const fallbackBuf = await sharp(processedBuffer).jpeg({ quality: 36, mozjpeg: true }).toBuffer()
        if (fallbackBuf && fallbackBuf.length <= PROFILE_MAX) {
          await sock.updateProfilePicture(sock.user.id, fallbackBuf)
          await sock.sendMessage(from, { text: encodeUnicodeText("✅ Foto profil berhasil diperbarui (fallback compression).") }, { quoted: msg })
          console.log("[SETPPPANJANG] Fallback compressed upload succeeded.")
          return
        }
      } catch (fb2Err) {
        console.warn("[SETPPPANJANG] Fallback compressed upload failed:", fb2Err?.message || fb2Err)
      }

      // If all attempts failed, provide helpful diagnostics to owner
      let friendly = "Gagal memperbarui foto profil. Pastikan sesi masih valid dan bot memiliki izin. Coba lagi atau gunakan gambar yang lebih kecil."
      if (String(upErr?.message || "").toLowerCase().includes("unauthorized") || String(upErr?.message || "").toLowerCase().includes("403")) {
        friendly = "Bot tidak memiliki izin untuk mengubah foto profil (unauthorized). Pastikan sesi masih aktif dan tidak dibatasi."
      } else if (String(upErr?.message || "").toLowerCase().includes("invalid")) {
        friendly = "Buffer gambar dianggap tidak valid oleh server. Coba gunakan gambar lain."
      }

      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ ${friendly}\n\nError: ${upErr?.message || upErr}`) }, { quoted: msg })
      return
    }
  } catch (err) {
    console.error("[SETPPPANJANG] Unexpected error:", err?.message || err)
    try { await sock.sendMessage(from, { text: encodeUnicodeText(`Terjadi kesalahan saat memproses .setpppanjang. Error: ${err?.message || err}`) }, { quoted: msg }) } catch (_) {}
    return
  }
}

      // ===============================
      // SET GROUP PROFILE PICTURE
      // ===============================
      if (cmd === ".setppgrup") {
        if (!isGroup) {
          return sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
            { quoted: msg },
          )
        }

        if (!isOwner) {
          return sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya owner bot yang bisa mengubah foto grup.") },
            { quoted: msg },
          )
        }

        const quotedMsg = getQuoted()
        const img = quotedMsg.message?.imageMessage

        if (!img) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Format salah!\n\nCara penggunaan:\n1. Kirim atau reply gambar\n2. Berikan caption: .setppgrup",
              ),
            },
            { quoted: msg },
          )
          return
        }

        try {
          const imageSize = img.fileLength || 0
          const imageMime = img.mimetype || "image/jpeg"

          if (imageSize > MAX_IMAGE_SIZE) {
            await sock.sendMessage(
              from,
              {
                text: `Ukuran gambar terlalu besar. Max 5MB, gambar Anda ${(imageSize / 1024 / 1024).toFixed(2)}MB`,
              },
              { quoted: msg },
            )
            return
          }

          if (!ALLOWED_MIME.includes(imageMime)) {
            await sock.sendMessage(
              from,
              { text: encodeUnicodeText("Format gambar tidak didukung. Gunakan JPEG, PNG, atau WEBP.") },
              { quoted: msg },
            )
            return
          }

          const stream = await downloadContentFromMessage(img, "image")
          let buffer = Buffer.from([])
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

          await sock.updateProfilePicture(from, buffer)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Foto profil grup berhasil diperbarui.") },
            { quoted: msg },
          )
        } catch (e) {
          console.error("SetPPGrup Error:", e.message)
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(`Gagal update foto profil grup. Error: ${e.message}`),
            },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // HIDE TAG
      // ===============================
      if (cmd === ".hidetag") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya owner bot yang bisa menggunakan perintah ini.") },
            { quoted: msg },
          )
          return
        }

        const tagText = args.slice(1).join(" ")

        if (!tagText) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Format: .hidetag <pesan>\n\nContoh: .hidetag Halo semuanya") },
            { quoted: msg },
          )
          return
        }

        try {
          const groupMetadata = await sock.groupMetadata(from)
          const members = groupMetadata.participants.map((p) => p.id)

          await sock.sendMessage(from, {
            text: tagText,
            mentions: members,
          })
        } catch (e) {
          console.error("HideTag Error:", e.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Gagal mengirim pesan tersembunyi. Coba lagi nanti.") },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // TAGALL - NEW FEATURE
      // .tagall <pesan> - Only Owner Utama
      if (cmd === ".tagall") {
        try {
          if (!isGroup) {
            await sock.sendMessage(
              from,
              { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
              { quoted: msg },
            )
            return
          }

          if (!isMainOwner) {
            await sock.sendMessage(
              from,
              { text: encodeUnicodeText("Hanya owner utama yang dapat menggunakan command ini.") },
              { quoted: msg },
            )
            return
          }

          const customMessage = args.slice(1).join(" ").trim()
          if (!customMessage) {
            await sock.sendMessage(
              from,
              {
                text: encodeUnicodeText(
                  "Format: .tagall <pesan>\nContoh: .tagall Halo semuanya, harap hadir rapat jam 7 malam."
                ),
              },
              { quoted: msg },
            )
            return
          }

          // Get group metadata and members
          const groupMetadata = await sock.groupMetadata(from)
          const allMembers = groupMetadata.participants.map((p) => p.id)

          if (!allMembers || allMembers.length === 0) {
            await sock.sendMessage(
              from,
              { text: encodeUnicodeText("Tidak dapat mengambil daftar member grup.") },
              { quoted: msg },
            )
            return
          }

          // WhatsApp may limit mentions per message. Split into chunks.
          const CHUNK_SIZE = 50 // safe default, adjust if needed
          const chunks = []
          for (let i = 0; i < allMembers.length; i += CHUNK_SIZE) {
            chunks.push(allMembers.slice(i, i + CHUNK_SIZE))
          }

          // Send messages for each chunk with mentions
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            // Build visible mention text, e.g., @12345 @67890 ...
            const mentionText = chunk.map((jid) => `@${jid.split("@")[0]}`).join(" ")

            // Compose message body: custom message + mentions block
            const body = `${customMessage}\n\n${mentionText}`

            await sock.sendMessage(from, {
              text: encodeUnicodeText(body),
              mentions: chunk,
            }, { quoted: msg })

            console.log(`[TAGALL] Sent chunk ${i + 1}/${chunks.length} to group ${from} (members: ${chunk.length})`)

            // Small delay to reduce risk of rate limits
            if (i < chunks.length - 1) {
              await new Promise((res) => setTimeout(res, 800))
            }
          }

          await sock.sendMessage(from, { text: encodeUnicodeText("Selesai menandai semua member.") }, { quoted: msg })
        } catch (err) {
          console.error("[TAGALL] Error:", err.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`Gagal menjalankan .tagall. Error: ${err.message}`) },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // CLOSE GROUP (LOCK GROUP)
      // ===============================
      if (cmd === ".closegroup") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di dalam grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya admin grup yang bisa menutup grup.") },
            { quoted: msg },
          )
          return
        }

        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Bot harus menjadi admin untuk menutup grup.") },
            { quoted: msg },
          )
          return
        }

        try {
          await sock.groupSettingUpdate(from, "announcement")
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Grup berhasil ditutup. Hanya admin yang dapat mengirim pesan.") },
            { quoted: msg },
          )
          console.log(`[CLOSEGROUP] Group ${from} has been locked by ${senderNumber}`)
        } catch (err) {
          console.error("[CLOSEGROUP] Error:", err.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Gagal menutup grup. Pastikan bot memiliki izin admin dan coba lagi.") },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // OPEN GROUP (UNLOCK GROUP)
      // ===============================
      if (cmd === ".opengroup") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di dalam grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya admin grup yang bisa membuka grup.") },
            { quoted: msg },
          )
          return
        }

        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Bot harus menjadi admin untuk membuka grup.") },
            { quoted: msg },
          )
          return
        }

        try {
          await sock.groupSettingUpdate(from, "not_announcement")
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Grup berhasil dibuka. Semua anggota sekarang bisa mengirim pesan.") },
            { quoted: msg },
          )
          console.log(`[OPENGROUP] Group ${from} has been unlocked by ${senderNumber}`)
        } catch (err) {
          console.error("[OPENGROUP] Error:", err.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Gagal membuka grup. Pastikan bot memiliki izin admin dan coba lagi.") },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // DELETE MESSAGE - FIXED
      // ===============================
      if (cmd === ".deletemsg") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya dapat digunakan di grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Perintah ini hanya untuk Owner.") }, { quoted: msg })
          return
        }

        // Check if this is a reply message
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo
        if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Reply pesan yang ingin dihapus.") }, { quoted: msg })
          return
        }

        // Check bot admin status
        const botAdminStatus = await isBotAdmin(sock, from)
        if (!botAdminStatus) {
          console.log(`[DELETEMSG] Bot admin check failed for group: ${from}`)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Bot harus menjadi admin untuk menghapus pesan.") },
            { quoted: msg },
          )
          return
        }

        try {
          console.log(`[DELETEMSG] Starting deletion process...`)
          console.log(`[DELETEMSG] Stanza ID: ${contextInfo.stanzaId}`)
          console.log(`[DELETEMSG] Participant: ${contextInfo.participant}`)
          console.log(`[DELETEMSG] Remote JID: ${from}`)

          // Build the message key for deletion
          const messageKey = {
            remoteJid: from,
            id: contextInfo.stanzaId,
            fromMe: false, // Always false for messages from other users
            participant: contextInfo.participant,
          }

          console.log(`[DELETEMSG] Message key:`, messageKey)

          // Use the sendMessage method with delete property (official Baileys way)
          await sock.sendMessage(from, { delete: messageKey })

          console.log(`[DELETEMSG] Message deleted successfully: ${contextInfo.stanzaId}`)
          await sock.sendMessage(from, { text: encodeUnicodeText("Pesan berhasil dihapus.") }, { quoted: msg })
        } catch (e) {
          console.error("[DELETEMSG] Error occurred:", e.message)
          console.error("[DELETEMSG] Error stack:", e.stack)

          let errorMsg = encodeUnicodeText("Gagal menghapus pesan. Pastikan bot adalah admin dan pesan masih ada.")

          if (e.message?.includes("403") || e.message?.includes("unauthorized")) {
            errorMsg = encodeUnicodeText("Bot tidak memiliki izin admin untuk menghapus pesan.")
          } else if (e.message?.includes("not found")) {
            errorMsg = encodeUnicodeText("Pesan tidak ditemukan atau sudah dihapus.")
          }

          await sock.sendMessage(from, { text: errorMsg }, { quoted: msg })
        }
        return
      }

      // ===============================
      // STICKER - IMAGE TO STICKER
      // ===============================
if (cmd === ".stiker") {
  try {
    const quotedMsg = getQuoted()
    const img = quotedMsg.message?.imageMessage

    if (!img) {
      await sock.sendMessage(
        from,
        {
          text: encodeUnicodeText(
            "Kirim atau reply gambar dengan .stiker\n\nCara penggunaan:\n1. Kirim atau reply gambar\n2. Berikan caption: .stiker\n\nTips: Gunakan gambar dengan format JPEG, PNG, atau WEBP.",
          ),
        },
        { quoted: msg },
      )
      return
    }

    const imageSize = img.fileLength || 0
    const imageMime = img.mimetype || "image/jpeg"

    // Validate image size
    if (imageSize > MAX_IMAGE_SIZE) {
      await sock.sendMessage(
        from,
        {
          text: `Ukuran gambar terlalu besar.\n\nMax 5MB, gambar Anda ${(imageSize / 1024 / 1024).toFixed(2)}MB\n\nSilakan pilih gambar yang lebih kecil.`,
        },
        { quoted: msg },
      )
      return
    }

    // Validate MIME type
    if (!ALLOWED_MIME.includes(imageMime)) {
      await sock.sendMessage(
        from,
        {
          text: encodeUnicodeText("Format gambar tidak didukung.\n\nFormat yang didukung: JPEG, PNG, atau WEBP"),
        },
        { quoted: msg },
      )
      return
    }

    await sock.sendMessage(from, { text: encodeUnicodeText("Sedang memproses gambar menjadi stiker...") }, { quoted: msg })

    // Download image
    const stream = await downloadContentFromMessage(img, "image")
    let buffer = Buffer.from([])
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

    if (!buffer || buffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengunduh gambar. Silakan coba lagi.") }, { quoted: msg })
      return
    }

    // Defensive preprocessing: resize to fit 512x512 (maintain aspect, transparent bg) to improve sticker quality
    let prepBuffer = buffer
    try {
      // keep aspect ratio; do not enlarge small images
      prepBuffer = await sharp(buffer)
        .rotate()
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        // prefer png as input to sticker formatter for best fidelity
        .png({ quality: 90 })
        .toBuffer()
    } catch (procErr) {
      // if preprocessing fails, continue with original buffer but log
      console.warn("[STICKER] Image preprocessing failed, using original buffer:", procErr?.message || procErr)
      prepBuffer = buffer
    }

    // Try to use wa-sticker-formatter first (professional sticker metadata support)
    let stickerBuffer = null
    let usedFormatter = false
    try {
      const mod = await import("wa-sticker-formatter")
      const StickerClass = mod?.Sticker || mod?.default || mod
      if (typeof StickerClass === "function") {
        const stickerObj = new StickerClass(prepBuffer, {
          pack: STICKER_PACK_NAME || "H56 WhatsApp Sticker",
          author: STICKER_AUTHOR || "HASYIM56",
          type: "crop",
          quality: 90,
        })
        // toBuffer() returns Buffer (Promise)
        stickerBuffer = await stickerObj.toBuffer()
        usedFormatter = true
      } else {
        // unexpected export shape - throw to trigger fallback
        throw new Error("Unexpected wa-sticker-formatter export shape")
      }
    } catch (formatterErr) {
      console.warn("[STICKER] wa-sticker-formatter not usable or failed:", formatterErr?.message || formatterErr)
      // fallback to existing convertToSticker which produces a webp sticker buffer
      try {
        stickerBuffer = await convertToSticker(prepBuffer)
        usedFormatter = false
      } catch (fallbackErr) {
        console.error("[STICKER] Fallback convertToSticker also failed:", fallbackErr?.message || fallbackErr)
        await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal membuat stiker. Error: ${fallbackErr?.message || fallbackErr}`) }, { quoted: msg })
        return
      }
    }

    if (!stickerBuffer || stickerBuffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal membuat stiker: hasil kosong.") }, { quoted: msg })
      return
    }

    // Send sticker
    await sock.sendMessage(
      from,
      {
        sticker: stickerBuffer,
      },
      {
        quoted: msg,
      },
    )

    console.log(`[STICKER] Sticker sent successfully (formatterUsed=${usedFormatter}) — size: ${stickerBuffer.length} bytes`)
  } catch (err) {
    console.error("[STICKER] Error:", err?.message || err)
    try {
      await sock.sendMessage(
        from,
        {
          text: encodeUnicodeText(`Gagal membuat stiker. Error: ${err?.message || err}`),
        },
        { quoted: msg },
      )
    } catch (_) {}
  }
  return
}

      // ===============================
      // AUDIO TO VOICE NOTE - .audiotovn (NEW)
      // Usage: reply an audio message with caption .audiotovn
      // Files stored in permanent folder: /HASYIM56/audio
if (cmd === ".audiotovn") {
  try {
    const quotedMsg = getQuoted()
    const quoted = quotedMsg?.message

    // Determine if quoted message contains audio
    const audioMsg = quoted?.audioMessage
    const docMsg = quoted?.documentMessage
    const isAudioDocument = docMsg && typeof docMsg.mimetype === "string" && docMsg.mimetype.startsWith("audio")
    const isVoiceNote = audioMsg || isAudioDocument

    if (!quoted || !isVoiceNote) {
      await sock.sendMessage(
        from,
        { text: encodeUnicodeText("Format salah. Reply pesan audio dengan caption .audiotovn untuk mengonversi menjadi Voice Note.") },
        { quoted: msg },
      )
      return
    }

    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Mengunduh dan menyiapkan audio untuk konversi menjadi Voice Note berkualitas...") }, { quoted: msg })

    // Download stream (defensive)
    let stream
    if (audioMsg) {
      stream = await downloadContentFromMessage(quoted.audioMessage, "audio")
    } else {
      stream = await downloadContentFromMessage(quoted.documentMessage, "document")
    }

    let buffer = Buffer.from([])
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

    if (!buffer || buffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengunduh audio. Coba lagi.") }, { quoted: msg })
      return
    }

    // Quick pass: if it's already Opus-in-OGG, attempt direct send as ptt
    const maybeExt = (typeof detectAudioExtension === "function") ? detectAudioExtension(buffer) : ""
    const isLikelyOpusOgg = maybeExt === ".ogg" && buffer.includes("OpusHead")

    if (isLikelyOpusOgg) {
      try {
        await sock.sendMessage(
          from,
          {
            audio: buffer,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true,
          },
          { quoted: msg },
        )
        console.log("[AUDIO->VN] Sent existing Opus/OGG as ptt for", senderNumber)
        return
      } catch (e) {
        console.warn("[AUDIO->VN] Direct send of Opus/OGG failed, will attempt re-encode:", e?.message || e)
        // continue to re-encode below
      }
    }

    // Ensure audio folder exists
    try {
      if (!fs.existsSync(AUDIO_FOLDER)) fs.mkdirSync(AUDIO_FOLDER, { recursive: true })
    } catch (e) {
      console.warn("[AUDIO->VN] Could not ensure audio folder exists:", e?.message || e)
    }

    // Prepare temporary filenames
    const ts = Date.now()
    const rnd = Math.random().toString(36).slice(2, 8)
    const inputExt = maybeExt || ".tmp"
    const inputPath = path.join(AUDIO_FOLDER, `audiotovn_in_${ts}_${rnd}${inputExt}`)
    const outputPath = path.join(AUDIO_FOLDER, `audiotovn_out_${ts}_${rnd}.ogg`)

    try {
      fs.writeFileSync(inputPath, buffer, { encoding: null })
    } catch (e) {
      console.error("[AUDIO->VN] Failed to write input file:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal menyimpan file sementara untuk konversi. Coba lagi nanti.") }, { quoted: msg })
      return
    }

    // PROFESSIONAL PIPELINE (preserve dynamics):
    // - minimal filtering only: remove rumble & extreme highs
    // - resample to 48k + mono
    // - encode with libopus application=voip (optim for voice notes)
    // - use VBR ON with moderate target bitrate (64k) to preserve waveform variation
    //
    // NOTE:
    // - We intentionally DO NOT use dynaudnorm/loudnorm here because they compress dynamics and
    //   are the likely cause of "datar" waveform.
    const ffArgs = [
      "-y",
      "-i", inputPath,
      "-map_metadata", "-1",
      // keep filtering minimal to preserve natural waveform
      "-af", "highpass=f=80, lowpass=f=12000, aresample=48000",
      // encode settings tuned for voice note behavior
      "-c:a", "libopus",
      "-vbr", "on",
      "-b:a", "64k",
      "-application", "voip",
      "-ac", "1",
      "-ar", "48000",
      outputPath,
    ]

    // Run ffmpeg and capture stderr for diagnostics
    const convErr = await new Promise((resolve) => {
      let ff
      try {
        ff = spawn(ffmpegPath, ffArgs, { stdio: ["ignore", "pipe", "pipe"] })
      } catch (spawnErr) {
        // cleanup input file
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
        return resolve(new Error(`ffmpeg start failed: ${spawnErr.message}`))
      }

      let stderr = ""
      ff.stderr.on("data", (c) => { stderr += c.toString() })

      ff.on("error", (err) => {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
        resolve(err)
      })

      ff.on("close", (code) => {
        if (code !== 0) {
          // cleanup both files
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
          return resolve(new Error(`ffmpeg exited with code ${code}. stderr: ${stderr.trim().split("\n").slice(-6).join("\n")}`))
        }
        // success
        return resolve(null)
      })
    })

    if (convErr) {
      console.error("[AUDIO->VN] ffmpeg conversion failed:", convErr?.message || convErr)
      const friendly = (convErr.message && convErr.message.toLowerCase().includes("ffmpeg")) ?
        "Gagal mengonversi audio karena ffmpeg tidak tersedia atau gagal dijalankan. Pastikan ffmpeg terpasang di server." :
        `Gagal mengonversi audio. Error: ${convErr.message || convErr}`

      // cleanup input
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}

      await sock.sendMessage(from, { text: encodeUnicodeText(friendly) }, { quoted: msg })
      return
    }

    // Read converted file
    let outBuffer = null
    try {
      outBuffer = fs.readFileSync(outputPath)
    } catch (e) {
      console.error("[AUDIO->VN] Failed to read converted file:", e?.message || e)
    }

    // Cleanup input file (we keep output until send)
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}

    if (!outBuffer || outBuffer.length === 0) {
      // fallback: send original as non-ptt with info
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal menghasilkan voice note berkualitas. Mengirim audio asli sebagai fallback.") }, { quoted: msg })
      await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mpeg", ptt: false }, { quoted: msg })
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
      return
    }

    // Send converted buffer as voice note (ptt)
    try {
      await sock.sendMessage(
        from,
        {
          audio: outBuffer,
          mimetype: "audio/ogg; codecs=opus",
          ptt: true,
        },
        { quoted: msg },
      )
      console.log(`[AUDIO->VN] Sent converted voice note to ${senderNumber} (size: ${outBuffer.length} bytes) — preserve-dynamics profile`)
    } catch (e) {
      console.error("[AUDIO->VN] Failed to send voice note:", e?.message || e)
      // fallback: try sending as non-ptt original/converted
      try {
        await sock.sendMessage(from, { audio: outBuffer || buffer, mimetype: outBuffer ? "audio/ogg; codecs=opus" : "audio/mpeg", ptt: false }, { quoted: msg })
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ (Fallback) Mengirim audio tanpa 'voice note' karena pengiriman ptt gagal.") }, { quoted: msg })
      } catch (e2) {
        console.error("[AUDIO->VN] Fallback send also failed:", e2?.message || e2)
        await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal mengirim voice note. Error: ${e2?.message || e2}`) }, { quoted: msg })
      }
    } finally {
      // cleanup converted file
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (e) { /* ignore */ }
    }
    return
  } catch (err) {
    console.error("[AUDIO->VN] Error:", err?.message || err)
    await sock.sendMessage(from, { text: encodeUnicodeText(`Terjadi kesalahan saat memproses .audiotovn. Error: ${err?.message || err}`) }, { quoted: msg })
    return
  }
}

      // ===============================
      // ADD MEMBER
      // ===============================
      if (cmd === ".addmember") {
        if (!isGroup) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Perintah ini hanya bisa digunakan di grup.") },
            { quoted: msg },
          )
          return
        }

        if (!isOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya owner bot yang bisa menambah member.") },
            { quoted: msg },
          )
          return
        }

        if (args.length < 2) {
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(
                "Format: .addmember <nomor>\nContoh: .addmember 6281234567890 atau .addmember 081234567890",
              ),
            },
            { quoted: msg },
          )
          return
        }

        const newMember = normalizeNumber(args[1])

        if (newMember.length < 10 || !newMember.startsWith("62")) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Nomor tidak valid. Pastikan format nomor benar.") },
            { quoted: msg },
          )
          return
        }

        try {
          await sock.groupParticipantsUpdate(from, [`${newMember}@s.whatsapp.net`], "add")
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`@${newMember} telah ditambahkan ke grup.`) },
            { quoted: msg },
          )
        } catch (e) {
          console.error("[ADDMEMBER] Error occurred:", e.message)
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText(`Gagal menambahkan member. Error: ${e.message}`) },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // QR CODE GENERATION
      // ===============================
      if (cmd === ".qrcode") {
        try {
          const qrcodeData = args.slice(1).join(" ")

          if (!qrcodeData) {
            await sock.sendMessage(
              from,
              {
                text: encodeUnicodeText(
                  "Format: .qrcode <URL atau teks>\n\nContoh:\n- .qrcode https://example.com\n- .qrcode Halo Dunia",
                ),
              },
              { quoted: msg },
            )
            return
          }

          // Show loading message
          await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Sedang membuat QR Code...") }, { quoted: msg })

          // Generate QR Code via API
          const qrResult = await generateQRCode(qrcodeData)

          // Convert base64 to buffer
          const imageBuffer = base64ToBuffer(qrResult.qr_data_url)

          // Send QR Code as image and save a copy in /HASYIM56/qrcode (permanent)
          const timestamp = Date.now()
          const filename = path.join(QRCODE_FOLDER, `qrcode_${timestamp}.png`)
          try {
            fs.writeFileSync(filename, imageBuffer)
          } catch (e) {
            console.warn("[QRCODE] Failed to save QR code to disk:", e.message)
          }

          // Send QR Code as image
          await sock.sendMessage(
            from,
            {
              image: imageBuffer,
              caption: encodeUnicodeText(`📱 QR Code untuk:\n${qrcodeData}`),
            },
            { quoted: msg },
          )

          console.log(`[QRCODE] QR Code sent successfully for: ${qrcodeData}`)
        } catch (err) {
          console.error("[QRCODE] Error:", err.message)
          await sock.sendMessage(
            from,
            {
              text: encodeUnicodeText(`❌ Gagal membuat QR Code\n\nError: ${err.message}`),
            },
            { quoted: msg },
          )
        }
        return
      }

      // ===============================
      // VIEW-ONCE RECOVERY - .viewonce (NEW ADDITION)
if (cmd === ".viewonce") {
  try {
    const context = msg.message?.extendedTextMessage?.contextInfo
    if (!context?.quotedMessage) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: Reply pesan view-once dengan caption .viewonce") }, { quoted: msg })
      return
    }

    const quotedMessage = context.quotedMessage

    // Identify inner media node and media type
    let mediaNode = null
    let mediaType = null // "image" | "video" | "audio" | "document" | "sticker"
    let mediaMime = ""

    // Preferred pattern: quotedMessage.viewOnceMessage.message.<type>Message
    if (quotedMessage.viewOnceMessage && quotedMessage.viewOnceMessage.message) {
      const inner = quotedMessage.viewOnceMessage.message
      if (inner.imageMessage) {
        mediaNode = inner.imageMessage
        mediaType = "image"
      } else if (inner.videoMessage) {
        mediaNode = inner.videoMessage
        mediaType = "video"
      } else if (inner.audioMessage) {
        mediaNode = inner.audioMessage
        mediaType = "audio"
      } else if (inner.documentMessage) {
        mediaNode = inner.documentMessage
        mediaType = "document"
      } else if (inner.stickerMessage) {
        mediaNode = inner.stickerMessage
        mediaType = "sticker"
      }
    }

    // Alternative shapes: message with viewOnce flags on top-level node
    if (!mediaNode) {
      if (quotedMessage.imageMessage && (quotedMessage.imageMessage.viewOnce || quotedMessage.imageMessage.isViewOnce)) {
        mediaNode = quotedMessage.imageMessage
        mediaType = "image"
      } else if (quotedMessage.videoMessage && (quotedMessage.videoMessage.viewOnce || quotedMessage.videoMessage.isViewOnce)) {
        mediaNode = quotedMessage.videoMessage
        mediaType = "video"
      } else if (quotedMessage.audioMessage && (quotedMessage.audioMessage.viewOnce || quotedMessage.audioMessage.isViewOnce)) {
        mediaNode = quotedMessage.audioMessage
        mediaType = "audio"
      } else if (quotedMessage.documentMessage && (quotedMessage.documentMessage.viewOnce || quotedMessage.documentMessage.isViewOnce)) {
        mediaNode = quotedMessage.documentMessage
        mediaType = "document"
      } else if (quotedMessage.stickerMessage && (quotedMessage.stickerMessage.viewOnce || quotedMessage.stickerMessage.isViewOnce)) {
        mediaNode = quotedMessage.stickerMessage
        mediaType = "sticker"
      }
    }

    // Fallback: direct media nodes
    if (!mediaNode) {
      if (quotedMessage.imageMessage) {
        mediaNode = quotedMessage.imageMessage
        mediaType = "image"
      } else if (quotedMessage.videoMessage) {
        mediaNode = quotedMessage.videoMessage
        mediaType = "video"
      } else if (quotedMessage.audioMessage) {
        mediaNode = quotedMessage.audioMessage
        mediaType = "audio"
      } else if (quotedMessage.documentMessage) {
        mediaNode = quotedMessage.documentMessage
        mediaType = "document"
      } else if (quotedMessage.stickerMessage) {
        mediaNode = quotedMessage.stickerMessage
        mediaType = "sticker"
      }
    }

    if (!mediaNode || !mediaType) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Tidak menemukan media view-once pada pesan yang direply.") }, { quoted: msg })
      return
    }

    // Friendly progress message
    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Mengambil media view-once... Mohon tunggu.") }, { quoted: msg })

    // Decide initial download type for baileys helper
    const decideDownloadType = (type, node) => {
      if (type === "image") return "image"
      if (type === "video") return "video"
      if (type === "sticker") return "image"
      // audio could be 'audio' or 'document' depending on wrapper
      if (type === "audio") {
        const m = node?.mimetype || ""
        if (m && m.startsWith("audio")) return m.includes("ogg") || m.includes("opus") ? "audio" : "document"
        return "audio"
      }
      // document fallback
      return "document"
    }

    const initialDownloadType = decideDownloadType(mediaType, mediaNode)

    // Build a "full quoted" object with key info (some baileys variants require this)
    const stanzaId = context?.stanzaId || context?.stanzaId // defensive
    const participant = context?.participant || context?.participant
    const quotedKey = {
      remoteJid: from,
      id: stanzaId || (msg?.key && msg.key.id) || "",
      fromMe: false,
      participant: participant || undefined,
    }
    const fullQuoted = { key: quotedKey, message: quotedMessage }

    // Prepare a sequence of download attempts (best-effort). Each attempt returns a stream or throws.
    const attempts = []

    // Attempt 1: direct media node + initialDownloadType
    attempts.push(async () => downloadContentFromMessage(mediaNode, initialDownloadType))

    // Attempt 2: quotedMessage object (full wrapper), same type
    attempts.push(async () => downloadContentFromMessage(quotedMessage, initialDownloadType))

    // Attempt 3: full quoted with key
    attempts.push(async () => downloadContentFromMessage(fullQuoted, initialDownloadType))

    // Attempt 4: synthetic viewOnce wrapper shape (some Baileys versions expect nested structure)
    attempts.push(async () => {
      const synthetic = { message: { viewOnceMessage: { message: { [`${mediaType}Message`]: mediaNode } } } }
      return downloadContentFromMessage(synthetic, initialDownloadType)
    })

    // Attempt 5: for audio, try alternate downloadType ('document' <-> 'audio')
    if (mediaType === "audio") {
      attempts.push(async () => downloadContentFromMessage(mediaNode, initialDownloadType === "audio" ? "document" : "audio"))
      attempts.push(async () => downloadContentFromMessage(quotedMessage, initialDownloadType === "audio" ? "document" : "audio"))
      attempts.push(async () => downloadContentFromMessage(fullQuoted, initialDownloadType === "audio" ? "document" : "audio"))
    }

    // Keep track of errors for diagnostics
    const errors = []
    let stream = null
    for (const tryFn of attempts) {
      try {
        // attempt download; some attempts may return stream or promise resolving to stream
        stream = await tryFn()
        if (stream) break
      } catch (e) {
        // Capture but do not bail out immediately on bad decrypt; try next fallback
        const msgErr = (e && e.message) || String(e)
        errors.push(msgErr)
        // If specific "bad decrypt" error, we try additional alternate strategies but continue the loop
        // (loop already contains alternates)
      }
    }

    if (!stream) {
      // Compose helpful diagnostic for owner/admin, but return friendly message to user
      const sampleErr = errors.length > 0 ? errors.slice(-3).join(" | ") : "unknown"
      console.error("[VIEWONCE] All download attempts failed. Samples:", sampleErr)
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengunduh media view-once. Media mungkin tidak tersedia, kadaluarsa, atau dekripsi gagal pada server. Silakan coba ulang atau hubungi admin.") }, { quoted: msg })
      return
    }

    // Concatenate stream into buffer
    let buffer = Buffer.from([])
    try {
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }
    } catch (e) {
      console.error("[VIEWONCE] Error while reading stream:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal membaca konten media view-once setelah diunduh.") }, { quoted: msg })
      return
    }

    if (!buffer || buffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal membaca konten media view-once.") }, { quoted: msg })
      return
    }

    // Determine mimetype and file extension
    mediaMime = mediaNode.mimetype || mediaNode.mimetype || ""
    const getExtFromMime = (m) => {
      if (!m) return ""
      if (m.includes("jpeg") || m.includes("jpg")) return ".jpg"
      if (m.includes("png")) return ".png"
      if (m.includes("webp")) return ".webp"
      if (m.includes("mp4")) return ".mp4"
      if (m.includes("x-matroska") || m.includes("mkv")) return ".mkv"
      if (m.includes("ogg") || m.includes("opus")) return ".ogg"
      if (m.includes("mpeg") || m.includes("mp3")) return ".mp3"
      if (m.includes("wav")) return ".wav"
      if (m.includes("pdf")) return ".pdf"
      return ""
    }

    let ext = getExtFromMime(mediaMime)
    if (!ext && mediaType === "audio" && typeof detectAudioExtension === "function") {
      try { ext = detectAudioExtension(buffer) } catch (e) { ext = ".ogg" }
    }
    if (!ext) {
      if (mediaType === "image") ext = ".jpg"
      else if (mediaType === "video") ext = ".mp4"
      else if (mediaType === "audio") ext = ".ogg"
      else if (mediaType === "sticker") ext = ".webp"
      else ext = ".bin"
    }

    // Save recovered file to permanent folder (best-effort)
    try {
      if (!fs.existsSync(MEDIAFIRE_FOLDER)) fs.mkdirSync(MEDIAFIRE_FOLDER, { recursive: true })
    } catch (e) {
      // ignore
    }
    const timestamp = Date.now()
    const baseName = `recovered_viewonce_${mediaType}_${timestamp}`
    const filePath = path.join(MEDIAFIRE_FOLDER, `${baseName}${ext}`)
    try {
      fs.writeFileSync(filePath, buffer)
    } catch (e) {
      console.warn("[VIEWONCE] Warning: could not save recovered file to disk:", e?.message || e)
    }

    // Compose captions & send according to media type
    const captionMap = {
      image: "🔁 Mengirim ulang (recovered) dari view-once sebagai gambar biasa.",
      video: "🔁 Mengirim ulang (recovered) dari view-once sebagai video biasa.",
      audio: "🔁 Mengirim ulang (recovered) dari view-once sebagai audio/voice-note biasa.",
      document: "🔁 Mengirim ulang (recovered) dari view-once sebagai file biasa.",
      sticker: "🔁 Mengirim ulang (recovered) dari view-once sebagai stiker/gambar.",
    }
    const userCaption = captionMap[mediaType] || "🔁 Mengirim ulang media (recovered) dari view-once."

    try {
      if (mediaType === "image" || mediaType === "sticker") {
        await sock.sendMessage(from, { image: buffer, caption: encodeUnicodeText(userCaption) }, { quoted: msg })
      } else if (mediaType === "video") {
        await sock.sendMessage(from, { video: buffer, caption: encodeUnicodeText(userCaption), gifPlayback: false }, { quoted: msg })
      } else if (mediaType === "audio") {
        // Determine if original was a voice-note (ptt) or generic audio
        const originalPtt = !!mediaNode.ptt || (mediaMime && (mediaMime.includes("opus") || mediaMime.includes("ogg")))
        if (originalPtt) {
          // If it's already opus/ogg, send as ptt
          const mimeToUse = mediaMime || "audio/ogg; codecs=opus"
          await sock.sendMessage(from, { audio: buffer, mimetype: mimeToUse, ptt: true }, { quoted: msg })
        } else {
          // send as regular audio file
          const mimeToUse = mediaMime || "audio/mpeg"
          await sock.sendMessage(from, { audio: buffer, mimetype: mimeToUse, ptt: false }, { quoted: msg })
        }
      } else {
        // generic document fallback
        const fileName = path.basename(filePath) || `${baseName}${ext}`
        await sock.sendMessage(from, { document: buffer, fileName, mimetype: mediaMime || "application/octet-stream" }, { quoted: msg })
      }
    } catch (sendErr) {
      console.error("[VIEWONCE] Failed to send recovered media:", sendErr?.message || sendErr)
      await sock.sendMessage(from, { text: encodeUnicodeText("Gagal mengirim media recovered. Coba lagi nanti.") }, { quoted: msg })
      return
    }

    // Final confirmation with professional message (includes saved path if available)
    try {
      const savedMsg = fs.existsSync(filePath) ? `Salinan disimpan di: ${filePath}` : "Salinan tidak disimpan di server."
      await sock.sendMessage(from, { text: encodeUnicodeText(`✅ Berhasil memulihkan media view-once.\nTipe: ${mediaType.toUpperCase()}\n${savedMsg}`) }, { quoted: msg })
      console.log(`[VIEWONCE] Recovered ${mediaType} for ${senderNumber} (chat ${from}) — saved: ${fs.existsSync(filePath) ? filePath : "not saved"}`)
    } catch (e) {
      console.warn("[VIEWONCE] Post-send confirmation failed:", e?.message || e)
    }
  } catch (err) {
    console.error("[VIEWONCE] Error:", err?.message || err, err)
    await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal memproses .viewonce. Error: ${err?.message || err}`) }, { quoted: msg })
  }
  return
}

      // ===============================
      // ADDITIONAL HANDLERS (TIKTOK, YOUTUBE, FWD, etc.) CONTINUE BELOW...
      // (rest of the code unchanged)
      // ===============================
    } catch (err) {
      console.error("[MESSAGE HANDLER ERROR]", err.message)
    }
  })

  // ===============================
  // TIKTOK COMMANDS (ADDED)
  // - .ttdownload <url>
  // - .ttsearch <username>
  // These handlers are intentionally added below the main handler without modifying existing logic.
  // ===============================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return

      const msg = messages[0]
      if (!msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = sender.split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isOwner = isUserOwner(senderNumber)
      const isFromBot = msg.key.fromMe === true

      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) {
        // private mode ignores non-owner messages
        return
      }

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

      // .ttdownload <url>

if (cmd === ".ttdownload") {
  try {
    const url = args.slice(1).join(" ").trim()
    // optional: allow second arg to be resolution (support both ".ttdownload <url> <res>" and ".ttdownload <url>")
    const resolutionArg = args[2] ? args[2].trim() : "720p"

    if (!url) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .ttdownload <url> [resolusi]\nContoh: .ttdownload https://www.tiktok.com/... 720p") }, { quoted: msg })
      return
    }

    // Enforce private chat only: do not allow usage in groups
    if (isGroup) {
      await sock.sendMessage(
        from,
        {
          text: encodeUnicodeText(
            "Perintah .ttdownload hanya dapat digunakan melalui chat pribadi (bukan grup).\n\nSilakan buka chat pribadi dengan bot dan coba lagi."
          ),
        },
        { quoted: msg },
      )
      return
    }

    // Inform user we started
    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Memulai proses download TikTok. Mohon tunggu...") }, { quoted: msg })

    // Ensure persistent storage folder exists (reusing YOUTUBE_FOLDER)
    try {
      if (!fs.existsSync(YOUTUBE_FOLDER)) fs.mkdirSync(YOUTUBE_FOLDER, { recursive: true })
    } catch (e) {
      console.warn("[TTDOWNLOAD] Gagal membuat folder youtube:", e?.message || e)
    }

    // Select python binary (best-effort)
    const pythonBins = ["python3", "python"]
    let pythonBin = null
    for (const b of pythonBins) {
      try {
        const proc = spawn(b, ["-V"])
        proc.on("error", () => {})
        pythonBin = b
        break
      } catch (e) {
        // ignore
      }
    }
    if (!pythonBin) pythonBin = "python3"

    // Build deterministic output template so result lands in YOUTUBE_FOLDER
    const timestamp = Date.now()
    const outTemplate = path.join(YOUTUBE_FOLDER, `tiktok_${timestamp}_%(title)s.%(ext)s`)

    // Ensure tiktok.py exists (downloader script)
    const scriptPath = path.join(process.cwd(), "tiktok.py")
    if (!fs.existsSync(scriptPath)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Script downloader tiktok.py tidak ditemukan di folder bot. Silakan letakkan tiktok.py di direktori kerja bot.") }, { quoted: msg })
      return
    }

    // Spawn downloader process
    const py = spawn(pythonBin, [scriptPath, url, "--resolution", resolutionArg, "--output", outTemplate], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let stderrBuffer = ""
    py.stdout.on("data", (d) => {
      try { stdout += d.toString() } catch (e) {}
    })
    py.stderr.on("data", (chunk) => {
      try { stderr += chunk.toString() } catch (e) {}
      try { stderrBuffer += chunk.toString() } catch (e) {}
    })

    // Progress UI: keep a single message and edit it (throttled)
    let progressMsg = null
    let lastEditAt = 0
    const EDIT_THROTTLE_MS = 900
    let lastDisplay = ""
    let lastProgressKey = ""

    const buildDisplayFromProgress = (obj) => {
      try {
        const header = "⬇️ Mengunduh video TikTok"
        const rawPercent = (obj.percent != null && !Number.isNaN(Number(obj.percent))) ? Number(obj.percent) : 0
        const pct = Math.max(0, Math.min(100, rawPercent))
        const pctInt = Math.round(pct)
        const BAR_LEN = 20
        const filled = Math.max(0, Math.min(BAR_LEN, Math.round((pctInt / 100) * BAR_LEN)))
        const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled)
        const speedVal = (obj.speed_kb_s != null && !Number.isNaN(Number(obj.speed_kb_s))) ? Number(obj.speed_kb_s) : 0
        const speedText = `${Math.round(speedVal)} KB/s`
        const lines = []
        lines.push(header)
        lines.push("")
        lines.push(`${bar} ${pctInt}%`)
        lines.push(`⚡ Kecepatan: ${speedText}`)
        lines.push("")
        lines.push("Tunggu sebentar — file akan dikirim setelah selesai.")
        return lines.join("\n")
      } catch (e) {
        return "⏳ Proses berjalan..."
      }
    }

    const parseAndMaybeEdit = (line) => {
      try {
        const trimmed = line.trim()
        if (!trimmed) return null
        const prefix = "TT_PROGRESS:"
        if (!trimmed.startsWith(prefix)) return null
        const jsonPart = trimmed.slice(prefix.length)
        const obj = JSON.parse(jsonPart)
        if (obj.percent == null) obj.percent = 0
        if (obj.speed_kb_s == null) obj.speed_kb_s = 0
        return obj
      } catch (e) {
        return null
      }
    }

    // Periodically drain stderrBuffer and update progress message
    const progressInterval = setInterval(async () => {
      try {
        if (!stderrBuffer) return
        const parts = stderrBuffer.split(/\r?\n/)
        stderrBuffer = parts.pop() || ""
        for (const ln of parts) {
          const obj = parseAndMaybeEdit(ln)
          if (!obj) continue
          const key = `${obj.phase||"download"}|${(obj.percent!=null?Number(obj.percent).toFixed(2):"0")}|${(obj.speed_kb_s!=null?Number(obj.speed_kb_s).toFixed(2):"0")}`
          if (key === lastProgressKey) continue
          lastProgressKey = key
          const display = buildDisplayFromProgress(obj)
          const now = Date.now()
          if (now - lastEditAt < EDIT_THROTTLE_MS) continue
          if (display === lastDisplay) {
            lastEditAt = now
            continue
          }
          lastDisplay = display
          lastEditAt = now
          try {
            if (!progressMsg) {
              progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
            } else {
              await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
            }
          } catch (e) {
            console.warn("[TTDOWNLOAD PROGRESS] edit failed (silent):", e?.message || e)
          }
        }
      } catch (e) {
        // swallow interval errors
      }
    }, 500)

    // Wait for process to complete
    const exitCode = await new Promise((resolve) => {
      py.on("close", (code) => resolve(code))
      py.on("error", () => resolve(1))
    })

    // Final flush of stderrBuffer
    try {
      const parts = stderrBuffer.split(/\r?\n/).filter(Boolean)
      for (const ln of parts) {
        const obj = parseAndMaybeEdit(ln)
        if (!obj) continue
        const display = buildDisplayFromProgress(obj)
        if (display !== lastDisplay) {
          try {
            if (!progressMsg) progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
            else await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
          } catch (e) {
            console.warn("[TTDOWNLOAD PROGRESS] final edit failed (silent):", e?.message || e)
          }
          lastDisplay = display
        }
      }
    } catch (e) {}

    clearInterval(progressInterval)

    // Final status edit
    try {
      const finalText = exitCode === 0 ? "✅ Proses download selesai. Mengirim file..." : "❌ Proses gagal."
      if (!progressMsg) {
        progressMsg = await sock.sendMessage(from, { text: finalText }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: finalText }, { edit: progressMsg.key })
      }
    } catch (e) {
      // ignore edit failure
    }

    if (exitCode !== 0) {
      // parse structured error if present
      let parsedErr = null
      try {
        const lastLine = stderr.trim().split("\n").slice(-1)[0] || ""
        parsedErr = JSON.parse(lastLine)
      } catch (e) {
        parsedErr = null
      }
      const errMsg = parsedErr && parsedErr.message ? parsedErr.message : (stderr.trim().split("\n").slice(-6).join("\n") || "Unknown error")
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mendownload TikTok. Error: ${errMsg}`) }, { quoted: msg })
      return
    }

    // Parse stdout JSON result from tiktok.py
    let parsed = null
    try {
      const out = stdout.trim()
      if (out) parsed = JSON.parse(out)
    } catch (e) {
      parsed = null
    }

    // Fallback: infer latest file in YOUTUBE_FOLDER if parser failed
    if (!parsed || !parsed.file) {
      let candidate = null
      try {
        const files = fs.readdirSync(YOUTUBE_FOLDER).map(f => ({ f, m: fs.statSync(path.join(YOUTUBE_FOLDER, f)).mtimeMs }))
        if (files.length > 0) {
          files.sort((a, b) => b.m - a.m)
          candidate = path.join(YOUTUBE_FOLDER, files[0].f)
          parsed = { file: candidate, filesize: fs.existsSync(candidate) ? fs.statSync(candidate).size : 0, title: path.basename(candidate, path.extname(candidate)) }
        }
      } catch (e) {}
    }

    if (!parsed || !parsed.file) {
      const errMsg = stderr.trim().split("\n").slice(-6).join("\n") || stdout.trim() || "Unknown result from downloader"
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Tidak mendapat hasil download. Log:\n${errMsg}`) }, { quoted: msg })
      return
    }

    const filePath = parsed.file
    const filesize = parsed.filesize || (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0)
    const title = parsed.title || path.basename(filePath, path.extname(filePath))

    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ File hasil download tidak ditemukan di server.") }, { quoted: msg })
      return
    }

    // WhatsApp upload size limit
    const WHATSAPP_UPLOAD_LIMIT = 100 * 1024 * 1024
    if (filesize > WHATSAPP_UPLOAD_LIMIT) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Ukuran file terlalu besar untuk dikirim lewat WhatsApp (${(filesize/1024/1024).toFixed(2)} MB). Batas: ${(WHATSAPP_UPLOAD_LIMIT/1024/1024).toFixed(0)} MB.`) }, { quoted: msg })
      return
    }

    // Send the video
    try {
      const fileBuffer = fs.readFileSync(filePath)
      const humanSize = (filesize / 1024 / 1024).toFixed(2) + " MB"
      const caption = encodeUnicodeText(`🎬 ${title}\n📦 Ukuran: ${humanSize}\n⚙️ Sumber: TikTok`)
      await sock.sendMessage(from, { video: fileBuffer, caption }, { quoted: msg })
    } catch (e) {
      console.error("[TTDOWNLOAD] Failed to send file:", e?.message || e)
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengirim file. Error: ${e?.message || e}`) }, { quoted: msg })
    } finally {
      // best-effort cleanup: remove the file to avoid filling disk (do not throw)
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch (e) {}
    }

  } catch (err) {
    console.error("[TTDOWNLOAD] Error:", err)
    await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Terjadi kesalahan saat memproses .ttdownload: ${err?.message || err}`) }, { quoted: msg })
  }
  return
}

      // .ttsearch <username>
      if (cmd === ".ttsearch") {
        try {
          const username = args[1] ? args[1].trim().replace(/^@/, "") : ""
          if (!username) {
            await sock.sendMessage(from, { text: encodeUnicodeText("Format: .ttsearch <username>") }, { quoted: msg })
            return
          }

          await sock.sendMessage(from, { text: encodeUnicodeText("Searching TikTok user...") }, { quoted: msg })

          const { ttSearch } = await import("./tiktok.js")
          const results = await ttSearch(username)

          if (!results || results.length === 0) {
            await sock.sendMessage(from, { text: encodeUnicodeText("Pengguna TikTok tidak ditemukan.") }, { quoted: msg })
            return
          }

          const top5 = results.slice(0, 5)
          let out = ""
          top5.forEach((u, i) => {
            out += `${i + 1}. @${u.username}\nName: ${u.nickname || "-"}\nFollowers: ${u.followers != null ? u.followers : "-"}\n\n`
          })

          await sock.sendMessage(from, { text: encodeUnicodeText(out.trim()) }, { quoted: msg })
        } catch (err) {
          console.error("[TTSEARCH] Error:", err.message)
          await sock.sendMessage(from, { text: encodeUnicodeText(`Gagal mencari pengguna TikTok. Error: ${err.message}`) }, { quoted: msg })
        }
        return
      }
    } catch (err) {
      console.error("[TIKTOK HANDLER ERROR]", err.message)
    }
  })

  // ===============================
  // FORWARD MANY TIMES MODE - COMMAND HANDLER
  // - .fwd on  -> enable
  // - .fwd off -> disable
  // Only Owner Utama can toggle
  // This handler is added modularly and won't change existing handlers.
  // ===============================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return

      const msg = messages[0]
      if (!msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = sender.split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isFromBot = msg.key.fromMe === true

      // Respect existing private mode behavior: if private and not owner, ignore
      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

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

      if (cmd === ".fwd") {
        // Only main owner can toggle
        if (!isMainOwner) {
          await sock.sendMessage(
            from,
            { text: encodeUnicodeText("Hanya Owner Utama yang dapat mengubah mode ini.") },
            { quoted: msg },
          )
          return
        }

        const sub = (args[1] || "").toLowerCase()
        if (sub === "on") {
          if (forwardManyTimesEnabled) {
            await sock.sendMessage(from, { text: encodeUnicodeText("Forward Many Times Mode sudah aktif.") }, { quoted: msg })
            return
          }
          forwardManyTimesEnabled = true
          console.log(`[FWD MODE] Enabled by ${senderNumber} at ${new Date().toISOString()}`)
          await sock.sendMessage(from, { text: encodeUnicodeText("Forward Many Times Mode: ON\nSemua pesan bot akan terlihat sebagai 'Diteruskan berkali-kali'.") }, { quoted: msg })
          return
        }

        if (sub === "off") {
          if (!forwardManyTimesEnabled) {
            await sock.sendMessage(from, { text: encodeUnicodeText("Forward Many Times Mode sudah nonaktif.") }, { quoted: msg })
            return
          }
          forwardManyTimesEnabled = false
          console.log(`[FWD MODE] Disabled by ${senderNumber} at ${new Date().toISOString()}`)
          await sock.sendMessage(from, { text: encodeUnicodeText("Forward Many Times Mode: OFF\nPesan bot kembali normal.") }, { quoted: msg })
          return
        }

        // Help text for .fwd
        await sock.sendMessage(from, { text: encodeUnicodeText("Format: .fwd <on|off>\nContoh: .fwd on") }, { quoted: msg })
        return
      }
    } catch (err) {
      console.error("[FWD HANDLER ERROR]", err.message)
    }
  })

  // ===============================
  // YOUTUBE DOWNLOADER (NON-INTRUSIVE ADDITION)
  // - .ytmp4 <url> <resolusi>
  // - Sends extra .ytmp4 documentation when user calls .menu (in addition to existing menu)
  // This is implemented as an additional, separate messages.upsert handler to avoid touching any existing code.
  // Enhancement: .ytmp4 usage is restricted to private chat only for better UX and reliability.
  // ===============================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return

      const msg = messages[0]
      if (!msg.message) return
      if (msg.key.remoteJid === "status@broadcast") return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = isGroup ? msg.key.participant || from : from
      const senderNumber = sender.split("@")[0]

      const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
      const isFromBot = msg.key.fromMe === true

      // Respect private mode
      if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

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

      // Send extra documentation about .ytmp4 when user calls .menu (non-intrusive)
      if (cmd === ".menu") {
        try {
          const extra = encodeUnicodeText(`
📥 YouTube Downloader (Tambahan)
- .ytmp4 <url> <resolusi>
  • Deskripsi: Mengunduh video YouTube dan mengirimkannya langsung ke WhatsApp dalam format MP4.
  • Resolusi: 360p, 480p, 720p, 1080p, atau 'best' untuk kualitas terbaik.
  • File hasil disimpan di: /HASYIM56/youtube
  • Contoh: .ytmp4 https://www.youtube.com/watch?v=XXXX 1080p
`)
          await sock.sendMessage(from, { text: extra }, { quoted: msg })
        } catch (e) {
          console.warn("[YTDL MENU EXTRA] Failed to send extra menu info:", e.message)
        }
      }

if (cmd === ".ytmp4") {
  try {
    const url = args[1] ? args[1].trim() : ""
    const resolution = args[2] ? args[2].trim() : "best"

    if (!url) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Format: .ytmp4 <url> <resolusi>\nContoh: .ytmp4 https://youtube.com/... 720p") }, { quoted: msg })
      return
    }

    // Restrict .ytmp4 to private chats only
    if (isGroup) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Perintah .ytmp4 hanya dapat digunakan melalui chat pribadi (bukan grup). Silakan hubungi bot via chat pribadi untuk mengunduh video YouTube.") }, { quoted: msg })
      return
    }

    // Notify start
    await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Memulai proses download YouTube. Mohon tunggu, proses dapat memakan waktu beberapa menit tergantung durasi dan resolusi.") }, { quoted: msg })

    // choose python binary
    const pythonBins = ["python3", "python"]
    let pythonBin = null
    for (const b of pythonBins) {
      try {
        const proc = spawn(b, ["-V"])
        proc.on("error", () => {})
        pythonBin = b
        break
      } catch (e) {
        // ignore
      }
    }
    if (!pythonBin) pythonBin = "python3"

    // confirm script exists
    const scriptPath = path.join(process.cwd(), "youtube.py")
    if (!fs.existsSync(scriptPath)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Script youtube.py tidak ditemukan di folder bot. Pastikan youtube.py ada di direktori kerja.") }, { quoted: msg })
      return
    }

    // spawn python downloader
    const py = spawn(pythonBin, [scriptPath, url, resolution], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    // collect stdout/stderr
    let stdout = ""
    let stderr = ""
    // we accumulate stderr in a buffer so we can parse progress JSON lines prefixed with "YT_PROGRESS:"
    let stderrBuffer = ""
    py.stdout.on("data", (d) => {
      try { stdout += d.toString() } catch (e) {}
    })
    py.stderr.on("data", (chunk) => {
      try { stderr += chunk.toString() } catch (e) {}
      try { stderrBuffer += chunk.toString() } catch (e) {}
    })

    // Progress editing: maintain single editable message
    let progressMsg = null
    let lastEditAt = 0
    const EDIT_THROTTLE_MS = 900 // at most ~1 edit/sec
    let lastDisplay = ""
    let lastProgressKey = ""

    // Build professional Indonesian UI from numeric progress object
    const buildDisplayFromProgress = (obj) => {
      try {
        const header = "⬇️ Mengunduh video YouTube"
        const phaseLabel = obj.phase ? `(${String(obj.phase)})` : ""
        const rawPercent = (obj.percent != null && !Number.isNaN(Number(obj.percent))) ? Number(obj.percent) : 0
        const pct = Math.max(0, Math.min(100, rawPercent))
        const pctInt = Math.round(pct)
        const BAR_LEN = 20
        const filled = Math.max(0, Math.min(BAR_LEN, Math.round((pctInt / 100) * BAR_LEN)))
        const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled)
        const speedVal = (obj.speed_kb_s != null && !Number.isNaN(Number(obj.speed_kb_s))) ? Number(obj.speed_kb_s) : 0
        const speedText = `${Math.round(speedVal)} KB/s`
        // downloaded / total in MB if available
        let sizeText = ""
        if (obj.downloaded != null && obj.total != null && obj.total > 0) {
          const dMB = (Number(obj.downloaded) / 1024 / 1024).toFixed(2)
          const tMB = (Number(obj.total) / 1024 / 1024).toFixed(2)
          sizeText = `Ukuran: ${dMB} / ${tMB} MB`
        } else if (obj.downloaded != null) {
          const dMB = (Number(obj.downloaded) / 1024 / 1024).toFixed(2)
          sizeText = `Ukuran terunduh: ${dMB} MB`
        }

        const lines = []
        lines.push(header + (phaseLabel ? ` ${phaseLabel}` : ""))
        lines.push("") // spacing
        lines.push(`${bar} ${pctInt}%`)
        if (sizeText) lines.push(sizeText)
        lines.push(`⚡ Kecepatan: ${speedText}`)
        lines.push("") // spacing
        lines.push("Tunggu sebentar — file akan dikirim setelah selesai.")
        return lines.join("\n")
      } catch (e) {
        return "⏳ Proses berjalan..."
      }
    }

    // Parse a single stderr line and return parsed object if it is YT_PROGRESS JSON
    const parseProgressLine = (line) => {
      try {
        const trimmed = line.trim()
        if (!trimmed) return null
        const prefix = "YT_PROGRESS:"
        if (!trimmed.startsWith(prefix)) return null
        const jsonPart = trimmed.slice(prefix.length)
        const obj = JSON.parse(jsonPart)
        // normalize fields
        if (obj.percent == null) obj.percent = 0
        if (obj.speed_kb_s == null) obj.speed_kb_s = 0
        if (obj.downloaded == null) obj.downloaded = obj.downloaded || 0
        if (obj.total == null) obj.total = obj.total || 0
        return obj
      } catch (e) {
        return null
      }
    }

    // Periodically drain stderrBuffer and update the SAME message via edit.
    const progressInterval = setInterval(async () => {
      try {
        if (!stderrBuffer) return
        const parts = stderrBuffer.split(/\r?\n/)
        stderrBuffer = parts.pop() || ""
        for (const ln of parts) {
          const obj = parseProgressLine(ln)
          if (!obj) continue

          // dedupe key to avoid redundant edits
          const key = `${obj.phase||"download"}|${(obj.percent!=null?Number(obj.percent).toFixed(2):"0")}|${(obj.speed_kb_s!=null?Number(obj.speed_kb_s).toFixed(2):"0")}`
          if (key === lastProgressKey) continue
          lastProgressKey = key

          const display = buildDisplayFromProgress(obj)
          const now = Date.now()
          if (now - lastEditAt < EDIT_THROTTLE_MS) {
            // throttle updates
            continue
          }
          if (display === lastDisplay) {
            lastEditAt = now
            continue
          }

          lastDisplay = display
          lastEditAt = now

          try {
            if (!progressMsg) {
              // initial message
              progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
            } else {
              // edit the same message
              await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
            }
          } catch (e) {
            // Silent: do not interrupt download on messaging failures
            console.warn("[YTDL PROGRESS] edit failed (ignored):", e?.message || e)
          }
        }
      } catch (e) {
        // ignore interval errors
      }
    }, 500)

    // wait for python process to finish
    const exitCode = await new Promise((resolve) => {
      py.on("close", (code) => resolve(code))
      py.on("error", () => resolve(1))
    })

    // final flush of any remaining buffered progress lines
    try {
      const parts = stderrBuffer.split(/\r?\n/).filter(Boolean)
      for (const ln of parts) {
        const obj = parseProgressLine(ln)
        if (!obj) continue
        const display = buildDisplayFromProgress(obj)
        if (display !== lastDisplay) {
          try {
            if (!progressMsg) progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
            else await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
          } catch (e) {
            console.warn("[YTDL PROGRESS] final edit failed (ignored):", e?.message || e)
          }
          lastDisplay = display
        }
      }
    } catch (e) {}

    clearInterval(progressInterval)

    // Final edit message showing completion or failure
    try {
      const finalText = exitCode === 0 ? "✅ Proses unduhan selesai. Mengirim file..." : "❌ Proses gagal."
      if (!progressMsg) {
        progressMsg = await sock.sendMessage(from, { text: finalText }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: finalText }, { edit: progressMsg.key })
      }
    } catch (e) {
      // ignore message edit failures
    }

    if (exitCode !== 0) {
      const errMsg = stderr ? stderr.trim().split("\n").slice(-6).join("\n") : "Unknown error"
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengunduh video. Error: ${errMsg}`) }, { quoted: msg })
      return
    }

    // Parse stdout JSON for final result (unchanged behavior)
    let parsed = null
    try {
      const lines = stdout.trim().split("\n").map(l => l.trim()).filter(Boolean)
      let jsonLine = null
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i]
        if (l.startsWith("{") && l.endsWith("}")) {
          jsonLine = l
          break
        }
      }
      if (!jsonLine && lines.length > 0) {
        const joined = lines.join(" ")
        const idx = joined.indexOf("{")
        if (idx >= 0) {
          jsonLine = joined.slice(idx)
        }
      }
      if (jsonLine) parsed = JSON.parse(jsonLine)
    } catch (e) {
      parsed = null
    }

    if (!parsed || !parsed.file) {
      let candidate = null
      try {
        const files = fs.readdirSync(YOUTUBE_FOLDER).map(f => ({ f, m: fs.statSync(path.join(YOUTUBE_FOLDER, f)).mtimeMs }))
        if (files.length > 0) {
          files.sort((a, b) => b.m - a.m)
          candidate = path.join(YOUTUBE_FOLDER, files[0].f)
          parsed = { file: candidate, filesize: fs.existsSync(candidate) ? fs.statSync(candidate).size : 0, title: path.basename(candidate, path.extname(candidate)) }
        }
      } catch (e) {}
    }

    if (!parsed || !parsed.file) {
      const errMsg = stderr.trim().split("\n").slice(-6).join("\n") || stdout.trim() || "Unknown result from downloader"
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Tidak mendapat hasil download. Log:\n${errMsg}`) }, { quoted: msg })
      return
    }

    const filePath = parsed.file
    const filesize = parsed.filesize || (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0)
    const title = parsed.title || path.basename(filePath, path.extname(filePath))

    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ File hasil download tidak ditemukan di server.") }, { quoted: msg })
      return
    }

    // copy to YOUTUBE_FOLDER if not already
    let sendPath = filePath
    try {
      if (!filePath.startsWith(YOUTUBE_FOLDER)) {
        const dest = path.join(YOUTUBE_FOLDER, `${Date.now()}_${path.basename(filePath)}`)
        fs.copyFileSync(filePath, dest)
        sendPath = dest
      }
    } catch (e) {
      console.warn("[YTDL] Failed to copy file to youtube folder:", e.message)
      sendPath = filePath
    }

    const WHATSAPP_UPLOAD_LIMIT = 100 * 1024 * 1024 // 100 MB
    if (filesize > WHATSAPP_UPLOAD_LIMIT) {
      await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Ukuran file terlalu besar untuk dikirim melalui WhatsApp (${(filesize/1024/1024).toFixed(2)} MB). Batas: ${(WHATSAPP_UPLOAD_LIMIT/1024/1024).toFixed(0)} MB.`) }, { quoted: msg })
      try { fs.unlinkSync(filePath) } catch (e) {}
      try { if (sendPath !== filePath && fs.existsSync(sendPath)) fs.unlinkSync(sendPath) } catch (e) {}
      return
    }

    const fileBuffer = fs.readFileSync(sendPath)
    const humanSize = (filesize / 1024 / 1024).toFixed(2) + " MB"
    const caption = encodeUnicodeText(`🎬 ${title}\n📦 Ukuran: ${humanSize}\n⚙️ Resolusi: ${resolution}`)

    await sock.sendMessage(from, { video: fileBuffer, caption }, { quoted: msg })

    try { fs.unlinkSync(filePath) } catch (e) { console.warn("[YTDL CLEANUP] Failed to remove original file:", e.message) }
    try { if (sendPath !== filePath && fs.existsSync(sendPath)) fs.unlinkSync(sendPath) } catch (e) { console.warn("[YTDL CLEANUP] Failed to remove copied file:", e.message) }

  } catch (err) {
    console.error("[YTDL HANDLER ERROR]", err)
    await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Terjadi error saat memproses permintaan YouTube: ${err.message || err}`) }, { quoted: msg })
  }
  return
}
    } catch (err) {
      console.error("[YTDL HANDLER ERROR OUTER]", err.message)
    }
  })
  
  // ===============================
// ADD-ON (non-intrusive): .ytmp3 handler
// - Usage: .ytmp3 <url> <bitrate>
// - Bitrate optional: 128 / 192 / 320 or 128k/192k/320k (default 192k)
// - Restriction: only in private chats (same rationale as .ytmp4)
// - Integrates with existing youtube.py (expects mode 'mp3' as third arg)
// - This block is self-contained and additive: append it near other handlers (e.g. after .ytmp4), do NOT modify other code.
// ===============================
sock.ev.on("messages.upsert", async ({ messages, type }) => {
  try {
    if (type !== "notify") return

    const msg = messages[0]
    if (!msg.message) return
    if (msg.key.remoteJid === "status@broadcast") return

    const from = msg.key.remoteJid
    const isGroup = from.endsWith("@g.us")
    const sender = isGroup ? msg.key.participant || from : from
    const senderNumber = sender.split("@")[0]

    const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
    const isFromBot = msg.key.fromMe === true

    // Respect private mode
    if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

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

    // Provide extra menu info about .ytmp3 (non-intrusive)
    if (cmd === ".menu") {
      try {
        const extra = encodeUnicodeText(`
📥 YouTube Downloader (Tambahan)
- .ytmp4 <url> <resolusi>
  • Download video MP4 (disimpan di /HASYIM56/youtube)
- .ytmp3 <url> <bitrate>
  • Download audio MP3 (khusus music). Bitrate opsional: 128 / 192 / 320 atau 128k/192k/320k. Default: 192k
  • File hasil disimpan di: /HASYIM56/youtube
  • Contoh: .ytmp3 https://www.youtube.com/watch?v=XXXX 320
`)
        await sock.sendMessage(from, { text: extra }, { quoted: msg })
      } catch (e) {
        console.warn("[YTMP3 MENU EXTRA] Failed to send extra menu info:", e?.message || e)
      }
      // don't return — let other .menu handlers also run if present
    }

    if (cmd === ".ytmp3") {
      try {
        const url = args[1] ? args[1].trim() : ""
        let bitrateArg = args[2] ? args[2].trim() : ""

        if (!url) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Format: .ytmp3 <url> <bitrate>\nContoh: .ytmp3 https://youtube.com/... 192") }, { quoted: msg })
          return
        }

        // Restrict .ytmp3 to private chats only (same policy as .ytmp4)
        if (isGroup) {
          await sock.sendMessage(from, { text: encodeUnicodeText("Perintah .ytmp3 hanya dapat digunakan melalui chat pribadi (bukan grup). Silakan hubungi bot via chat pribadi untuk mengunduh audio YouTube.") }, { quoted: msg })
          return
        }

        await sock.sendMessage(from, { text: encodeUnicodeText("⏳ Memulai proses download audio YouTube. Mohon tunggu, proses bisa memakan waktu beberapa menit tergantung durasi.") }, { quoted: msg })

        // Determine python binary
        const pythonBins = ["python3", "python"]
        let pythonBin = null
        for (const b of pythonBins) {
          try {
            const proc = spawn(b, ["-V"])
            proc.on("error", () => {})
            pythonBin = b
            break
          } catch (e) {
            // ignore
          }
        }
        if (!pythonBin) pythonBin = "python3"

        // Path to youtube.py (must exist in cwd)
        const scriptPath = path.join(process.cwd(), "youtube.py")
        if (!fs.existsSync(scriptPath)) {
          await sock.sendMessage(from, { text: encodeUnicodeText("❌ Script youtube.py tidak ditemukan di folder bot. Pastikan youtube.py ada di direktori kerja.") }, { quoted: msg })
          return
        }

        // Prepare python args: [scriptPath, url, bitrateOpt?, "mp3"]
        const pyArgs = [scriptPath, url]
        if (bitrateArg) pyArgs.push(bitrateArg)
        // always ensure explicit 'mp3' mode param (youtube.py accepts arg2 or arg3)
        pyArgs.push("mp3")

        const py = spawn(pythonBin, pyArgs, {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""
        let stderrBuffer = ""
        py.stdout.on("data", (d) => {
          try { stdout += d.toString() } catch (e) {}
        })
        py.stderr.on("data", (chunk) => {
          try { stderr += chunk.toString() } catch (e) {}
          try { stderrBuffer += chunk.toString() } catch (e) {}
        })

        // Progress edit logic (keeps a single message and edits it)
        let progressMsg = null
        let lastEditAt = 0
        const EDIT_THROTTLE_MS = 900
        let lastDisplay = ""
        let lastProgressKey = ""

        const buildDisplayFromProgress = (obj) => {
          try {
            const header = "🎧 Mengunduh audio YouTube"
            const rawPercent = (obj.percent != null && !Number.isNaN(Number(obj.percent))) ? Number(obj.percent) : 0
            const pct = Math.max(0, Math.min(100, rawPercent))
            const pctInt = Math.round(pct)
            const BAR_LEN = 20
            const filled = Math.max(0, Math.min(BAR_LEN, Math.round((pctInt / 100) * BAR_LEN)))
            const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled)
            const speedVal = (obj.speed_kb_s != null && !Number.isNaN(Number(obj.speed_kb_s))) ? Number(obj.speed_kb_s) : 0
            const speedText = `${Math.round(speedVal)} KB/s`
            const lines = []
            lines.push(header)
            lines.push("")
            lines.push(`${bar} ${pctInt}%`)
            lines.push(`⚡ Kecepatan: ${speedText}`)
            lines.push("")
            lines.push("Tunggu sebentar — file audio akan dikirim setelah selesai.")
            return lines.join("\n")
          } catch (e) {
            return "⏳ Proses berjalan..."
          }
        }

        const parseAndMaybeEdit = (line) => {
          try {
            const trimmed = line.trim()
            if (!trimmed) return null
            const prefix = "YT_PROGRESS:"
            if (!trimmed.startsWith(prefix)) return null
            const jsonPart = trimmed.slice(prefix.length)
            const obj = JSON.parse(jsonPart)
            if (obj.percent == null) obj.percent = 0
            if (obj.speed_kb_s == null) obj.speed_kb_s = 0
            return obj
          } catch (e) {
            return null
          }
        }

        const progressInterval = setInterval(async () => {
          try {
            if (!stderrBuffer) return
            const parts = stderrBuffer.split(/\r?\n/)
            stderrBuffer = parts.pop() || ""
            for (const ln of parts) {
              const obj = parseAndMaybeEdit(ln)
              if (!obj) continue
              const key = `${obj.phase||"download"}|${(obj.percent!=null?Number(obj.percent).toFixed(2):"0")}|${(obj.speed_kb_s!=null?Number(obj.speed_kb_s).toFixed(2):"0")}`
              if (key === lastProgressKey) continue
              lastProgressKey = key
              const display = buildDisplayFromProgress(obj)
              const now = Date.now()
              if (now - lastEditAt < EDIT_THROTTLE_MS) continue
              if (display === lastDisplay) {
                lastEditAt = now
                continue
              }
              lastDisplay = display
              lastEditAt = now
              try {
                if (!progressMsg) {
                  progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
                } else {
                  await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
                }
              } catch (e) {
                console.warn("[YTMP3 PROGRESS] edit failed (silent):", e?.message || e)
              }
            }
          } catch (e) {
            // swallow
          }
        }, 500)

        // wait exit
        const exitCode = await new Promise((resolve) => {
          py.on("close", (code) => resolve(code))
          py.on("error", () => resolve(1))
        })

        // flush remaining stderrBuffer
        try {
          const parts = stderrBuffer.split(/\r?\n/).filter(Boolean)
          for (const ln of parts) {
            const obj = parseAndMaybeEdit(ln)
            if (!obj) continue
            const display = buildDisplayFromProgress(obj)
            if (display !== lastDisplay) {
              try {
                if (!progressMsg) progressMsg = await sock.sendMessage(from, { text: display }, { quoted: msg })
                else await sock.sendMessage(from, { text: display }, { edit: progressMsg.key })
              } catch (e) {
                console.warn("[YTMP3 PROGRESS] final edit failed (silent):", e?.message || e)
              }
              lastDisplay = display
            }
          }
        } catch (e) {}

        clearInterval(progressInterval)

        try {
          const finalText = exitCode === 0 ? "✅ Proses unduhan audio selesai. Mengirim file..." : "❌ Proses gagal."
          if (!progressMsg) progressMsg = await sock.sendMessage(from, { text: finalText }, { quoted: msg })
          else await sock.sendMessage(from, { text: finalText }, { edit: progressMsg.key })
        } catch (e) {
          // ignore
        }

        if (exitCode !== 0) {
          const errMsg = stderr ? stderr.trim().split("\n").slice(-6).join("\n") : "Unknown error"
          await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengunduh audio. Error: ${errMsg}`) }, { quoted: msg })
          return
        }

        // Parse stdout for final JSON
        let parsed = null
        try {
          const lines = stdout.trim().split("\n").map(l => l.trim()).filter(Boolean)
          let jsonLine = null
          for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i]
            if (l.startsWith("{") && l.endsWith("}")) {
              jsonLine = l
              break
            }
          }
          if (!jsonLine && lines.length > 0) {
            const joined = lines.join(" ")
            const idx = joined.indexOf("{")
            if (idx >= 0) {
              jsonLine = joined.slice(idx)
            }
          }
          if (jsonLine) parsed = JSON.parse(jsonLine)
        } catch (e) {
          parsed = null
        }

        if (!parsed || !parsed.file) {
          const stdoutTrim = stdout.trim()
          const possible = stdoutTrim.split("\n").map(l => l.trim()).filter(Boolean)
          let fileCandidate = null
          if (possible.length > 0) fileCandidate = possible[possible.length - 1]
          if (fileCandidate && fs.existsSync(fileCandidate)) {
            parsed = { file: fileCandidate, filesize: fs.statSync(fileCandidate).size, title: path.basename(fileCandidate, path.extname(fileCandidate)) }
          } else {
            const errMsg = stderr.trim().split("\n").slice(-6).join("\n") || stdoutTrim || "Unknown result from downloader"
            await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Tidak mendapat hasil download. Log:\n${errMsg}`) }, { quoted: msg })
            return
          }
        }

        const filePath = parsed.file
        const filesize = parsed.filesize || (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0)
        const title = parsed.title || path.basename(filePath, path.extname(filePath))

        if (!fs.existsSync(filePath)) {
          await sock.sendMessage(from, { text: encodeUnicodeText("❌ File hasil download tidak ditemukan di server.") }, { quoted: msg })
          return
        }

        // Copy to permanent youtube folder if not already there
        let sendPath = filePath
        try {
          if (!filePath.startsWith(YOUTUBE_FOLDER)) {
            const dest = path.join(YOUTUBE_FOLDER, `${Date.now()}_${path.basename(filePath)}`)
            fs.copyFileSync(filePath, dest)
            sendPath = dest
          }
        } catch (e) {
          console.warn("[YTMP3] Failed to copy file to youtube folder:", e.message)
          sendPath = filePath
        }

        const WHATSAPP_UPLOAD_LIMIT = 100 * 1024 * 1024 // 100 MB
        if (filesize > WHATSAPP_UPLOAD_LIMIT) {
          await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Ukuran file terlalu besar untuk dikirim melalui WhatsApp (${(filesize/1024/1024).toFixed(2)} MB). Batas: ${(WHATSAPP_UPLOAD_LIMIT/1024/1024).toFixed(0)} MB.`) }, { quoted: msg })
          try { fs.unlinkSync(filePath) } catch (e) {}
          try { if (sendPath !== filePath && fs.existsSync(sendPath)) fs.unlinkSync(sendPath) } catch (e) {}
          return
        }

        const fileBuffer = fs.readFileSync(sendPath)
        const humanSize = (filesize / 1024 / 1024).toFixed(2) + " MB"
        const caption = encodeUnicodeText(`🎵 ${title}\n📦 Ukuran: ${humanSize}\n⚙️ Format: MP3`)

        // Send audio (not ptt)
        await sock.sendMessage(from, { audio: fileBuffer, mimetype: "audio/mpeg", ptt: false, fileName: path.basename(sendPath), caption }, { quoted: msg })

        // Cleanup temp files (best-effort)
        try { fs.unlinkSync(filePath) } catch (e) {}
        try { if (sendPath !== filePath && fs.existsSync(sendPath)) fs.unlinkSync(sendPath) } catch (e) {}

      } catch (err) {
        console.error("[YTMP3 HANDLER ERROR]", err)
        await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Terjadi error saat memproses permintaan YTMP3: ${err.message || err}`) }, { quoted: msg })
      }
      return
    }

  } catch (err) {
    console.error("[YTMP3 HANDLER OUTER ERROR]", err?.message || err)
  }
})

// HANDLER: .audiofake — create a fake-duration audio/voice-note and send it.

sock.ev.on("messages.upsert", async ({ messages, type }) => {
  try {
    if (type !== "notify") return

    const msg = messages[0]
    if (!msg || !msg.message) return
    if (msg.key.remoteJid === "status@broadcast") return

    const from = msg.key.remoteJid
    const isGroup = from.endsWith("@g.us")
    const sender = isGroup ? msg.key.participant || from : from
    const senderNumber = sender.split("@")[0]

    const isMainOwner = isUserOwner(senderNumber) && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
    const isOwner = isUserOwner(senderNumber)
    const isFromBot = msg.key.fromMe === true

    // Respect existing access mode (private/public)
    if (BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

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

    if (cmd !== ".audiofake") return

    // Permission: only owners (to avoid abuse). Change to isMainOwner if you want only primary owner.
    if (!isOwner) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner: hanya owner bot yang dapat menggunakan perintah .audiofake.") }, { quoted: msg })
      return
    }

    // Parse requested duration (seconds) - last numeric token
    const durationArg = (() => {
      for (let i = args.length - 1; i >= 1; i--) {
        const v = args[i].replace(/[^\d]/g, "")
        if (v && /^\d+$/.test(v)) return Number(v)
      }
      return null
    })()

    const DEFAULT_DURATION = 3600 // 1 hour
    const MAX_DURATION = 24 * 60 * 60 // safety cap
    let seconds = durationArg == null ? DEFAULT_DURATION : Number(durationArg)
    if (!Number.isFinite(seconds) || seconds <= 0) seconds = DEFAULT_DURATION
    if (seconds > MAX_DURATION) seconds = MAX_DURATION

    // Determine mention / reply target (optional)
    const context = msg.message?.extendedTextMessage?.contextInfo
    const mentioned = context?.mentionedJid || []
    let mentionJid = mentioned && mentioned.length > 0 ? mentioned[0] : null
    if (!mentionJid && context?.participant) mentionJid = context.participant

    // Acknowledge start (non-blocking)
    try { await sock.sendMessage(from, { text: encodeUnicodeText(`⏳ Menyiapkan audio palsu (durasi: ${seconds} detik)...`) }, { quoted: msg }) } catch (_) {}

    // Build quoted object for downloads (if reply)
    const quotedObj = (() => {
      if (!context?.quotedMessage) return null
      return {
        key: { remoteJid: from, id: context.stanzaId, participant: context.participant },
        message: context.quotedMessage,
      }
    })()

    // Helper: robust conversion to Opus-in-OGG in AUDIO_FOLDER using ffmpeg
    const convertBufferToOpusOgg = async (inputBuffer) => {
      const ts = Date.now()
      const rnd = Math.random().toString(36).slice(2, 8)
      const inExt = detectAudioExtension(inputBuffer) || ".tmp"
      const inputPath = path.join(AUDIO_FOLDER, `audiofake_in_${ts}_${rnd}${inExt}`)
      const outputPath = path.join(AUDIO_FOLDER, `audiofake_out_${ts}_${rnd}.ogg`)

      try {
        if (!fs.existsSync(AUDIO_FOLDER)) fs.mkdirSync(AUDIO_FOLDER, { recursive: true })
      } catch (e) {
        throw new Error(`Cannot ensure audio folder: ${e.message}`)
      }

      try {
        fs.writeFileSync(inputPath, inputBuffer, { encoding: null })
      } catch (e) {
        throw new Error(`Failed to write temporary input file: ${e.message}`)
      }

      // Parameters tuned for WhatsApp voice-note (mono, 48k, libopus, application=voip)
      const args = [
        "-y",
        "-i", inputPath,
        "-map_metadata", "-1",
        "-c:a", "libopus",
        "-b:a", "64k",
        "-vbr", "on",
        "-application", "voip",
        "-ac", "1",
        "-ar", "48000",
        outputPath,
      ]

      return new Promise((resolve, reject) => {
        let ff
        try {
          ff = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] })
        } catch (spawnErr) {
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
          return reject(new Error(`ffmpeg start failed: ${spawnErr.message}`))
        }

        let stderr = ""
        ff.stderr.on("data", (c) => { stderr += c.toString() })

        ff.on("error", (err) => {
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
          reject(new Error(`ffmpeg error: ${err.message || err}`))
        })

        ff.on("close", (code) => {
          // cleanup input
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
          if (code !== 0) {
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
            return reject(new Error(`ffmpeg exited ${code}. stderr: ${stderr.trim().split("\n").slice(-4).join("\n")}`))
          }
          try {
            const out = fs.readFileSync(outputPath)
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
            resolve(out)
          } catch (e) {
            reject(new Error(`Failed to read ffmpeg output: ${e.message}`))
          }
        })
      })
    }

    // Try to obtain an audio buffer:
    // Prefer quoted audio/document/video (extract audio), otherwise use existing sample/generate silent opus.
    let audioBuffer = null
    let audioMimetype = "audio/ogg; codecs=opus" // default for voice-note

    // 1) If reply contains media try to download and, if needed, convert.
    if (quotedObj?.message) {
      try {
        const q = quotedObj.message
        const innerType = Object.keys(q)[0]

        // prefer 'audioMessage' or 'documentMessage' with audio mime or even 'videoMessage' if present
        if (innerType === "audioMessage") {
          const stream = await downloadContentFromMessage(q.audioMessage, "audio")
          let buf = Buffer.from([])
          for await (const ch of stream) buf = Buffer.concat([buf, ch])
          if (buf.length > 0) {
            // If already opus/ogg with OpusHead, keep; else convert
            const ext = detectAudioExtension(buf)
            const isOpusOgg = ext === ".ogg" && buf.includes("OpusHead")
            if (isOpusOgg) {
              audioBuffer = buf
              audioMimetype = q.audioMessage.mimetype || audioMimetype
            } else {
              // convert to opus/ogg for reliable ptt playback
              try {
                audioBuffer = await convertBufferToOpusOgg(buf)
                audioMimetype = "audio/ogg; codecs=opus"
              } catch (e) {
                console.warn("[AUDIOFAKE] Conversion of quoted audio failed, will fallback to original mp3 as non-ptt:", e.message)
                audioBuffer = buf // fallback: keep original for non-ptt sending later
                audioMimetype = q.audioMessage.mimetype || "audio/mpeg"
              }
            }
          }
        } else if (innerType === "documentMessage" && q.documentMessage.mimetype && q.documentMessage.mimetype.startsWith("audio")) {
          const stream = await downloadContentFromMessage(q.documentMessage, "document")
          let buf = Buffer.from([])
          for await (const ch of stream) buf = Buffer.concat([buf, ch])
          if (buf.length > 0) {
            const ext = detectAudioExtension(buf)
            const isOpusOgg = ext === ".ogg" && buf.includes("OpusHead")
            if (isOpusOgg) {
              audioBuffer = buf
              audioMimetype = q.documentMessage.mimetype || audioMimetype
            } else {
              try {
                audioBuffer = await convertBufferToOpusOgg(buf)
                audioMimetype = "audio/ogg; codecs=opus"
              } catch (e) {
                console.warn("[AUDIOFAKE] Conversion of quoted document audio failed, using original as non-ptt:", e.message)
                audioBuffer = buf
                audioMimetype = q.documentMessage.mimetype || "audio/mpeg"
              }
            }
          }
        } else if (innerType === "videoMessage") {
          // extract audio track by converting short segment (or full) to opus/ogg
          const stream = await downloadContentFromMessage(q.videoMessage, "video")
          let buf = Buffer.from([])
          for await (const ch of stream) buf = Buffer.concat([buf, ch])
          if (buf.length > 0) {
            try {
              audioBuffer = await convertBufferToOpusOgg(buf)
              audioMimetype = "audio/ogg; codecs=opus"
            } catch (e) {
              console.warn("[AUDIOFAKE] Extract audio from video failed:", e.message)
              audioBuffer = null
            }
          }
        }
      } catch (e) {
        console.warn("[AUDIOFAKE] Error downloading quoted media (will fallback):", e?.message || e)
      }
    }

    // 2) If still no audioBuffer, try to use sample file or generate a small opus sample (re-use existing logic)
    if (!audioBuffer) {
      const sampleFilePath = path.join(AUDIO_FOLDER, "audiofake_sample.ogg")

      const ensureSampleAudio = async () => {
        try {
          if (fs.existsSync(sampleFilePath)) return fs.readFileSync(sampleFilePath)
        } catch (e) {}
        // Generate a short silent opus if ffmpeg available
        try {
          if (!fs.existsSync(AUDIO_FOLDER)) fs.mkdirSync(AUDIO_FOLDER, { recursive: true })
          const tmpOut = sampleFilePath
          const args = [
            "-y",
            "-f", "lavfi",
            "-i", "anullsrc=r=48000:cl=mono",
            "-t", "0.8",
            "-c:a", "libopus",
            "-b:a", "32k",
            tmpOut,
          ]
          await new Promise((resolve, reject) => {
            let ff
            try {
              ff = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] })
            } catch (spawnErr) {
              return reject(new Error(`ffmpeg spawn failed: ${spawnErr.message}`))
            }
            let stderr = ""
            ff.stderr.on("data", (c) => { stderr += c.toString() })
            ff.on("error", (err) => reject(err))
            ff.on("close", (code) => {
              if (code !== 0) return reject(new Error(`ffmpeg exited ${code}. stderr: ${stderr.trim().split("\n").slice(-3).join("\n")}`))
              resolve()
            })
          })
          if (fs.existsSync(sampleFilePath)) return fs.readFileSync(sampleFilePath)
        } catch (e) {
          console.warn("[AUDIOFAKE] Could not generate sample audio:", e.message)
        }

        // Try to pick any existing audio file in AUDIO_FOLDER
        try {
          const files = fs.readdirSync(AUDIO_FOLDER).filter((f) => /\.(mp3|ogg|opus|m4a|wav)$/i.test(f))
          if (files.length > 0) return fs.readFileSync(path.join(AUDIO_FOLDER, files[0]))
        } catch (e) {}

        return null
      }

      audioBuffer = await ensureSampleAudio()
      if (audioBuffer) audioMimetype = "audio/ogg; codecs=opus"
    }

    // If still no audio, notify failure
    if (!audioBuffer || audioBuffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal mempersiapkan audio untuk .audiofake. Pastikan ffmpeg tersedia atau letakkan file audio di folder /HASYIM56/audio") }, { quoted: msg })
      return
    }

    // Decide whether we can/should send as ptt (voice note)
    const extGuess = detectAudioExtension(audioBuffer)
    const alreadyOpusOgg = extGuess === ".ogg" && audioBuffer.includes("OpusHead")

    // If buffer is not Opus/OGG and we want reliable ptt, attempt conversion (unless it's already attempted above)
    if (!alreadyOpusOgg) {
      try {
        const converted = await convertBufferToOpusOgg(audioBuffer)
        if (converted && converted.length > 0) {
          audioBuffer = converted
          audioMimetype = "audio/ogg; codecs=opus"
        }
      } catch (e) {
        // conversion failed — we'll fallback to sending original as non-ptt
        console.warn("[AUDIOFAKE] Final conversion to opus failed, will send original as non-ptt:", e.message)
      }
    }

    // Build payload: prefer ptt true when format is Opus/OGG; otherwise send as normal audio (ptt false)
    const isPtt = (audioMimetype && audioMimetype.includes("opus")) || (detectAudioExtension(audioBuffer) === ".ogg" && audioBuffer.includes("OpusHead"))

    const sendPayload = {
      audio: audioBuffer,
      mimetype: audioMimetype || (isPtt ? "audio/ogg; codecs=opus" : "audio/mpeg"),
      ptt: Boolean(isPtt),
      seconds: seconds,
    }

    const opts = { quoted: msg }

    try {
      // Send audio in the same chat
      await sock.sendMessage(from, sendPayload, opts)

      // If mention target provided, follow-up with mention message (keeps main audio send simple)
      if (mentionJid) {
        const targetMentionText = `🔊 Audio palsu (durasi: ${seconds} detik) untuk @${extractJidNumber(mentionJid)} — dihasilkan oleh ${DEV_NAME}`
        await sock.sendMessage(from, { text: encodeUnicodeText(targetMentionText), mentions: [mentionJid] })
      } else {
        await sock.sendMessage(from, { text: encodeUnicodeText(`✅ Sukses mengirim audio palsu dengan durasi ${seconds} detik.`) }, { quoted: msg })
      }
      console.log(`[AUDIOFAKE] Sent audiofake to ${from} (by ${senderNumber}) — ptt:${sendPayload.ptt}, seconds:${seconds}`)
    } catch (e) {
      console.error("[AUDIOFAKE] Failed to send audiofake:", e?.message || e)
      // If send as ptt failed (maybe because format not supported), fallback: send as regular audio file without ptt
      try {
        await sock.sendMessage(from, { audio: audioBuffer, mimetype: "audio/mpeg", ptt: false }, { quoted: msg })
        await sock.sendMessage(from, { text: encodeUnicodeText(`✅ (Fallback) Mengirim audio tanpa 'voice note'. Durasi palsu tetap: ${seconds} detik.`) }, { quoted: msg })
      } catch (e2) {
        console.error("[AUDIOFAKE] Fallback send also failed:", e2?.message || e2)
        await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengirim audio palsu. Error: ${e2?.message || e2}`) }, { quoted: msg })
      }
    }

    return
  } catch (err) {
    console.error("[AUDIOFAKE] Handler error:", err?.message || err)
    try { await sock.sendMessage(msg.key.remoteJid, { text: encodeUnicodeText(`Terjadi kesalahan saat memproses .audiofake: ${err?.message || err}`) }, { quoted: msg }) } catch (_) {}
    return
  }
})

sock.ev.on("messages.upsert", async ({ messages, type }) => {
  try {
    if (type !== "notify") return
    if (!Array.isArray(messages) || messages.length === 0) return

    const msg = messages[0]
    if (!msg || !msg.message) return
    if (msg.key.remoteJid === "status@broadcast") return

    const from = msg.key.remoteJid
    const isGroup = (from || "").endsWith("@g.us")
    const sender = isGroup ? msg.key.participant || from : from
    const senderNumber = String(sender).split("@")[0]

    const isOwner = isUserOwner(senderNumber)
    const isMainOwner = isOwner && normalizeNumber(senderNumber) === normalizeNumber(OWNER_NUMBER)
    const isFromBot = msg.key.fromMe === true

    // Respect access mode
    if (typeof BOT_ACCESS_MODE !== "undefined" && BOT_ACCESS_MODE === "private" && !isMainOwner && !isFromBot) return

    // extract text safely
    const messageType = Object.keys(msg.message)[0]
    const text =
      messageType === "conversation"
        ? msg.message.conversation
        : messageType === "extendedTextMessage"
        ? msg.message.extendedTextMessage.text
        : messageType === "imageMessage"
        ? msg.message.imageMessage.caption
        : ""

    if (!text || typeof text !== "string") return
    const args = text.trim().split(/\s+/)
    const cmd = (args[0] || "").toLowerCase()
    if (cmd !== ".audiofakev2") return

    // Permission: same as .audiofake
    if (!isOwner) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Khusus Owner: hanya owner yang dapat menggunakan perintah .audiofakev2.") }, { quoted: msg })
      return
    }

    // Robustly locate the quoted message from many shapes
    const extractQuoted = (m) => {
      try {
        // 1) common: extendedTextMessage.contextInfo
        const ext = m.message?.extendedTextMessage?.contextInfo
        if (ext && (ext.quotedMessage || ext.stanzaId)) {
          return { quoted: ext.quotedMessage || ext, stanzaId: ext.stanzaId || ext.id, participant: ext.participant || ext.participant }
        }
        // 2) some nodes have contextInfo under their message[type]
        const types = Object.keys(m.message || {})
        for (const t of types) {
          try {
            const node = m.message[t]
            const ctx = node?.contextInfo || node?.extendedTextMessage?.contextInfo
            if (ctx && (ctx.quotedMessage || ctx.stanzaId)) {
              return { quoted: ctx.quotedMessage || ctx, stanzaId: ctx.stanzaId || ctx.id, participant: ctx.participant }
            }
          } catch (e) {}
        }
        // 3) fallback: maybe top-level has quotedMessage directly
        if (m.message?.conversation && m.message?.contextInfo && m.message.contextInfo.quotedMessage) {
          const c = m.message.contextInfo
          return { quoted: c.quotedMessage, stanzaId: c.stanzaId, participant: c.participant }
        }
        return null
      } catch (e) {
        return null
      }
    }

    const found = extractQuoted(msg)
    if (!found || !found.quoted) {
      await sock.sendMessage(from, { text: encodeUnicodeText("Gunakan .audiofakev2 dengan membalas pesan yang berisi audio/voice-note/dokumen audio. Contoh: reply audio lalu tulis .audiofakev2 1h atau .audiofakev2 3600") }, { quoted: msg })
      return
    }

    const quotedMessageNode = found.quoted

    // Parse requested duration (flexible formats)
    const parseDuration = (s) => {
      if (!s) return null
      s = String(s).trim().toLowerCase()
      if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
        const parts = s.split(":").map(Number)
        if (parts.length === 2) return parts[0] * 60 + parts[1]
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      }
      const m = s.match(/^(\d+(?:\.\d+)?)(h|m|s)?$/)
      if (m) {
        const v = Number(m[1])
        const unit = m[2] || "s"
        if (unit === "h") return Math.round(v * 3600)
        if (unit === "m") return Math.round(v * 60)
        return Math.round(v)
      }
      if (/^\d+$/.test(s)) return Number(s)
      return null
    }

    const DEFAULT_SECONDS = 3600
    let targetSeconds = parseDuration(args[1]) || DEFAULT_SECONDS
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) targetSeconds = DEFAULT_SECONDS

    // Inform start
    await sock.sendMessage(from, { text: encodeUnicodeText(`⏳ Menyiapkan audio fake (durasi target: ${targetSeconds} detik)...`) }, { quoted: msg })

    // Try multiple download types (audio, document, video) similar to other robust handlers
    const downloadCandidates = ["audio", "document", "video"]
    let stream = null
    for (const dtype of downloadCandidates) {
      try {
        // some nodes expect the quotedMessage itself, others the inner media node
        // try quotedMessage node first, then quotedMessage[dtype + "Message"] if exists
        try {
          stream = await downloadContentFromMessage(quotedMessageNode, dtype)
        } catch (e) {
          // try inner message shape (e.g., quotedMessage.audioMessage)
          const innerKey = Object.keys(quotedMessageNode || {}).find(k => k.toLowerCase().includes(dtype))
          if (innerKey && quotedMessageNode[innerKey]) {
            try { stream = await downloadContentFromMessage(quotedMessageNode[innerKey], dtype) } catch (e2) {}
          }
        }
        if (stream) break
      } catch (e) {
        stream = null
      }
    }

    if (!stream) {
      // as last attempt, try download from the wrapper that includes key (some baileys shapes)
      try {
        const synthetic = { key: { remoteJid: from, id: found.stanzaId || msg.key.id, participant: found.participant || undefined }, message: quotedMessageNode }
        stream = await downloadContentFromMessage(synthetic, "audio").catch(() => null)
      } catch (e) {
        stream = null
      }
    }

    if (!stream) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal mengunduh konten audio dari pesan yang direply. Pastikan pesan yang direply berisi audio/voice-note atau dokumen audio.") }, { quoted: msg })
      return
    }

    // Accumulate into buffer
    let inputBuffer = Buffer.from([])
    try {
      for await (const chunk of stream) inputBuffer = Buffer.concat([inputBuffer, chunk])
    } catch (e) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal membaca stream audio setelah diunduh. Coba lagi.") }, { quoted: msg })
      return
    }

    if (!inputBuffer || inputBuffer.length === 0) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Konten audio kosong atau tidak dapat diunduh.") }, { quoted: msg })
      return
    }

    // Ensure audio folder exists
    try { if (!fs.existsSync(AUDIO_FOLDER)) fs.mkdirSync(AUDIO_FOLDER, { recursive: true }) } catch (e) {}

    const ts = Date.now()
    const rnd = Math.random().toString(36).slice(2, 8)
    const inExt = (typeof detectAudioExtension === "function" && detectAudioExtension(inputBuffer)) || ".tmp"
    const inputPath = path.join(AUDIO_FOLDER, `audiofakev2_in_${ts}_${rnd}${inExt}`)
    const outputPath = path.join(AUDIO_FOLDER, `audiofakev2_out_${ts}_${rnd}.ogg`)

    try { fs.writeFileSync(inputPath, inputBuffer, { encoding: null }) } catch (e) {
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal menyimpan file sementara untuk konversi. Pastikan bot dapat menulis ke folder audio.") }, { quoted: msg })
      return
    }

    // Build ffmpeg args for padding/trimming with apad (robust)
    const makeFFmpegArgs = (src, dest, durSeconds) => {
      return [
        "-y",
        "-i", src,
        "-filter_complex", `[0:a]apad=pad_dur=${durSeconds}[a]`,
        "-map", "[a]",
        "-t", String(durSeconds),
        "-c:a", "libopus",
        "-b:a", "64k",
        "-vbr", "on",
        "-application", "voip",
        "-ac", "1",
        "-ar", "48000",
        dest,
      ]
    }

    const runFfmpeg = (args) => {
      return new Promise((resolve, reject) => {
        let proc
        try {
          proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] })
        } catch (err) {
          return reject(new Error(`ffmpeg spawn failed: ${err?.message || err}`))
        }
        let stderr = ""
        proc.stderr.on("data", (c) => { stderr += c.toString() })
        proc.on("error", (err) => reject(err))
        proc.on("close", (code) => {
          if (code !== 0) return reject(new Error(`ffmpeg exited ${code}. stderr: ${stderr.trim().split("\n").slice(-6).join("\n")}`))
          try {
            const out = fs.readFileSync(outputPath)
            resolve(out)
          } catch (e) {
            reject(new Error(`Failed to read ffmpeg output: ${e?.message || e}`))
          }
        })
      })
    }

    let outBuffer = null
    try {
      if (!ffmpegPath) throw new Error("ffmpeg tidak ditemukan pada PATH")
      const argsF = makeFFmpegArgs(inputPath, outputPath, targetSeconds)
      outBuffer = await runFfmpeg(argsF)
    } catch (err) {
      // fallback: try convert source first to opus then pad
      try {
        // convert to opus temp
        const convTmp = path.join(AUDIO_FOLDER, `audiofakev2_conv_${ts}_${rnd}.ogg`)
        const convArgs = [
          "-y", "-i", inputPath,
          "-c:a", "libopus",
          "-b:a", "64k",
          "-vbr", "on",
          "-application", "voip",
          "-ac", "1",
          "-ar", "48000",
          convTmp,
        ]
        await runFfmpeg(convArgs)
        // overwrite inputPath with convTmp buffer
        const convBuf = fs.readFileSync(convTmp)
        fs.writeFileSync(inputPath, convBuf)
        try { fs.unlinkSync(convTmp) } catch (_) {}
        const argsF2 = makeFFmpegArgs(inputPath, outputPath, targetSeconds)
        outBuffer = await runFfmpeg(argsF2)
      } catch (err2) {
        // final failure
        console.error("[AUDIOFAKEV2] ffmpeg failure:", err2?.message || err2)
      }
    }

    if (!outBuffer || outBuffer.length === 0) {
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
      await sock.sendMessage(from, { text: encodeUnicodeText("❌ Gagal membuat audio palsu. Pastikan ffmpeg tersedia dan coba lagi.") }, { quoted: msg })
      return
    }

    // Send as voice note (ptt)
    try {
      await sock.sendMessage(from, {
        audio: outBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
        seconds: targetSeconds,
      }, { quoted: msg })

      await sock.sendMessage(from, { text: encodeUnicodeText(`✅ Sukses membuat audio dengan durasi palsu ${targetSeconds} detik.`) }, { quoted: msg })
    } catch (sendErr) {
      // fallback send non-ptt
      try {
        await sock.sendMessage(from, {
          audio: outBuffer,
          mimetype: "audio/ogg; codecs=opus",
          ptt: false,
          seconds: targetSeconds,
        }, { quoted: msg })
        await sock.sendMessage(from, { text: encodeUnicodeText("✅ (Fallback) Mengirim audio tanpa ptt.") }, { quoted: msg })
      } catch (e) {
        await sock.sendMessage(from, { text: encodeUnicodeText(`❌ Gagal mengirim hasil audio. Error: ${e?.message || e}`) }, { quoted: msg })
      }
    } finally {
      // cleanup
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath) } catch (_) {}
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
    }
  } catch (err) {
    console.error("[AUDIOFAKEV2] Handler unexpected error:", err?.message || err)
    try { await sock.sendMessage(messages && messages[0] && messages[0].key ? messages[0].key.remoteJid : OWNER_JID, { text: encodeUnicodeText(`⚠️ Terjadi kesalahan internal pada .audiofakev2: ${err?.message || err}`) }) } catch (_) {}
  }
})

// AUTO-READ & RECORDING INDICATOR
{
  // small util
  const delay = (ms) => new Promise((res) => setTimeout(res, ms))

  try {
    sock.ev.on("messages.upsert", async (m) => {
      try {
        if (!m.messages || m.type !== "notify") return

        const keysToRead = []
        for (const msg of m.messages) {
          if (!msg || !msg.key) continue
          // skip own messages and status broadcasts
          if (msg.key.fromMe) continue
          if (!msg.key.remoteJid || msg.key.remoteJid === "status@broadcast") continue
          // Collect keys (avoid duplicates)
          keysToRead.push(msg.key)
        }

        if (keysToRead.length === 0) return

        // Deduplicate by id
        const uniq = []
        const seen = new Set()
        for (const k of keysToRead) {
          const id = `${k.remoteJid}|${k.id}|${k.participant || ""}`
          if (!seen.has(id)) {
            seen.add(id)
            uniq.push(k)
          }
        }

        // Best-effort: call readMessages once for the batch
        try {
          if (typeof sock.readMessages === "function") {
            await sock.readMessages(uniq).catch(() => {})
          } else if (typeof sock.readMessage === "function") {
            // Older/newer variants: attempt per-key fallback
            for (const k of uniq) {
              try { await sock.readMessage(k).catch(()=>{}) } catch(e) {}
            }
          }
        } catch (e) {
          // silent fail: do not interfere with rest of program
          console.warn("[AUTO READ] readMessages failed (ignored):", e?.message || e)
        }
      } catch (e) {
        console.error("[AUTO READ] handler error (ignored):", e?.message || e)
      }
    })
    console.log("[AUTO READ] Handler installed.")
  } catch (e) {
    console.warn("[AUTO READ] Failed to install handler:", e?.message || e)
  }

  // RECORDING INDICATOR: wrap sendMessage to show 'recording' presence while bot sends a response
  try {
    if (sock && typeof sock.sendMessage === "function") {
      const originalSendMessage = sock.sendMessage.bind(sock)

      // Wrap once; if double-wrapped (rare), avoid re-wrapping
      if (!originalSendMessage.__hasRecordingWrapper) {
        const wrapped = async (jid, message, options = {}) => {
          // Do not try to set presence for invalid jids or if fromMe/no jid
          try {
            if (jid && typeof sock.sendPresenceUpdate === "function") {
              // Best-effort: set recording, but ignore failures
              try {
                await sock.sendPresenceUpdate("recording", jid).catch(() => {})
              } catch (_) {}
            }
          } catch (e) {
            // ignore
          }

          // Minimal human-like delay so indicator is visible when responding to users.
          // Keep small to not slow down bot noticeably.
          try {
            await delay(1000) // 1 second feels natural/professional
          } catch (_) {}

          // Send the actual message (this will call any previously-installed wrappers)
          let result
          try {
            result = await originalSendMessage(jid, message, options)
          } catch (sendErr) {
            // attempt to clear recording indicator even if send failed
            try {
              if (jid && typeof sock.sendPresenceUpdate === "function") {
                await sock.sendPresenceUpdate("paused", jid).catch(() => {})
              }
            } catch (_) {}
            throw sendErr
          }

          // After sending, set presence to paused (stop recording)
          try {
            if (jid && typeof sock.sendPresenceUpdate === "function") {
              await sock.sendPresenceUpdate("paused", jid).catch(() => {})
            }
          } catch (e) {
            // ignore
          }

          return result
        }

        // mark wrapper to avoid double-wrap
        wrapped.__hasRecordingWrapper = true

        // Install wrapper in a way that preserves any existing references to sock.sendMessage
        sock.sendMessage = wrapped
        console.log("[RECORDING INDICATOR] sendMessage wrapper installed (shows recording while responding).")
      } else {
        console.log("[RECORDING INDICATOR] sendMessage already wrapped; skipping double-wrap.")
      }
    } else {
      console.warn("[RECORDING INDICATOR] sock.sendMessage not available; wrapper not installed.")
    }
  } catch (e) {
    console.warn("[RECORDING INDICATOR] Failed to install wrapper:", e?.message || e)
  }
}

// SELF-AUTO-REACT

{
  const SELF_REACT = {
    ENABLED: true,
    EMOJI_INITIAL: "🕒",       // initial "processing" emoji
    EMOJI_DONE: "✅",         // final "done" emoji
    INITIAL_DELAY_MS: 500,    // wait after outgoing message before sending initial react
    DONE_DELAY_MS: 1400,      // additional wait before sending final react
    DEDUPE_TTL_MS: 12_000,    // how long to keep a reacted message in memory
  }

  try {
    if (!sock || typeof sock.ev?.on !== "function") {
      console.warn("[SELF-REACT] sock or sock.ev not available; self-react not installed.")
    } else if (!SELF_REACT.ENABLED) {
      console.log("[SELF-REACT] Disabled by configuration.")
    } else {
      // Track scheduled tasks and already-reacted message ids
      if (!sock.__selfReactStore) sock.__selfReactStore = { pending: new Map(), reacted: new Map() }

      const addReacted = (key) => {
        try {
          sock.__selfReactStore.reacted.set(key, Date.now())
          // schedule deletion after TTL
          setTimeout(() => {
            try { sock.__selfReactStore.reacted.delete(key) } catch (_) {}
          }, SELF_REACT.DEDUPE_TTL_MS)
        } catch (_) {}
      }

      const hasReacted = (key) => {
        try { return sock.__selfReactStore.reacted.has(key) } catch (_) { return false }
      }

      // Safe reaction sender: try canonical shape then fallback
      const safeSendReaction = async (remoteJid, messageKey, emoji) => {
        try {
          if (!remoteJid || !messageKey || !messageKey.id) return
          // canonical:
          await sock.sendMessage(remoteJid, { react: { text: emoji, key: messageKey } })
          return true
        } catch (err) {
          // fallback: some versions accept different key shapes (best-effort)
          try {
            const fallbackKey = {
              id: messageKey.id || (messageKey.key && messageKey.key.id) || "",
              remoteJid: messageKey.remoteJid || remoteJid,
              participant: messageKey.participant,
            }
            await sock.sendMessage(remoteJid, { react: { text: emoji, key: fallbackKey } })
            return true
          } catch (err2) {
            console.warn("[SELF-REACT] send reaction failed:", err2?.message || err)
            return false
          }
        }
      }

      // Helper: determine if message is reaction-type (skip to avoid loops)
      const isReactionPayload = (m) => {
        try {
          if (!m || !m.message) return false
          const t = Object.keys(m.message)[0] || ""
          if (!t) return false
          // common reaction node names
          if (t === "reactionMessage" || t === "react" || t === "reactMessage") return true
          // some newer shapes may expose a 'react' property
          if (m.message.react || m.message.reactionMessage) return true
          return false
        } catch (e) {
          return false
        }
      }

      // Main watcher: listens for outgoing messages and schedules two-stage reacts
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
          if (type !== "notify") return
          if (!Array.isArray(messages) || messages.length === 0) return

          for (const m of messages) {
            try {
              if (!m || !m.key || !m.key.fromMe) continue // only outgoing/bot messages
              if (!m.key.remoteJid || m.key.remoteJid === "status@broadcast") continue
              if (!m.key.id) continue

              // Skip if the outgoing message itself is a reaction (avoid loops)
              if (isReactionPayload(m)) continue

              const remote = m.key.remoteJid
              const id = m.key.id
              const participant = m.key.participant || undefined
              const dedupeKey = `${remote}|${id}|${participant || ""}`

              // If we've already reacted recently, skip
              if (hasReacted(dedupeKey)) continue

              // If there is already a pending scheduled react for this message, skip
              if (sock.__selfReactStore.pending.has(dedupeKey)) {
                // refresh timers: clear and reschedule to keep behavior consistent
                const info = sock.__selfReactStore.pending.get(dedupeKey)
                try { clearTimeout(info.initialTid) } catch (_) {}
                try { clearTimeout(info.doneTid) } catch (_) {}
                sock.__selfReactStore.pending.delete(dedupeKey)
              }

              // Build canonical messageKey for reaction target
              const messageKey = { id, remoteJid: remote, participant }

              // Schedule initial react
              const initialTid = setTimeout(async () => {
                try {
                  await safeSendReaction(remote, messageKey, SELF_REACT.EMOJI_INITIAL)
                } catch (e) {
                  // swallow
                }
              }, SELF_REACT.INITIAL_DELAY_MS)

              // Schedule done react (sent after initial)
              const doneTid = setTimeout(async () => {
                try {
                  await safeSendReaction(remote, messageKey, SELF_REACT.EMOJI_DONE)
                  // mark reacted to avoid repeats
                  addReacted(dedupeKey)
                } catch (e) {
                  // swallow
                } finally {
                  // cleanup pending entry
                  try { sock.__selfReactStore.pending.delete(dedupeKey) } catch (_) {}
                }
              }, SELF_REACT.INITIAL_DELAY_MS + SELF_REACT.DONE_DELAY_MS)

              // store pending tids so they can be cleared if duplicates happen
              sock.__selfReactStore.pending.set(dedupeKey, { initialTid, doneTid, createdAt: Date.now() })

              // Final safety: ensure pending entry auto-cleans after TTL
              setTimeout(() => {
                try {
                  const p = sock.__selfReactStore.pending.get(dedupeKey)
                  if (p) {
                    try { clearTimeout(p.initialTid) } catch (_) {}
                    try { clearTimeout(p.doneTid) } catch (_) {}
                    sock.__selfReactStore.pending.delete(dedupeKey)
                  }
                } catch (_) {}
              }, SELF_REACT.DEDUPE_TTL_MS + 2000)
            } catch (inner) {
              console.warn("[SELF-REACT] per-message scheduling error:", inner?.message || inner)
            }
          }
        } catch (e) {
          console.error("[SELF-REACT] messages.upsert watcher error:", e?.message || e)
        }
      })

      console.log("[SELF-REACT] Outgoing-message self-react watcher installed (two-stage, professional).")
    }
  } catch (err) {
    console.error("[SELF-REACT] Installation failed:", err?.message || err)
  }
}
// ========== END: SELF-AUTO-REACT ==========

// ========== START: AUTO-REACT (PROFESSIONAL) ==========
// Insert this block immediately AFTER:
//   console.log("[RECORDING INDICATOR] sendMessage wrapper installed (shows recording while responding).")
{
  // Non-intrusive auto-react system
  const pendingReactions = new Map() // key: remoteJid|id -> { timeoutId, createdAt }

  // Configuration
  const REACT_PROCESSING = "🕒" // initial processing reaction
  const REACT_DONE = "✅"       // final success reaction
  const AUTO_COMPLETE_MS = 45_000 // 45 seconds fallback to auto-complete

  // Helper: build map key
  const buildPendingKey = (remoteJid, id, participant) => `${remoteJid}|${id}|${participant || ""}`

  // Helper: try-send reaction (safe)
  const safeSendReaction = async (sock, remoteJid, messageKey, emoji) => {
    try {
      if (!sock || typeof sock.sendMessage !== "function") return
      await sock.sendMessage(remoteJid, { react: { text: emoji, key: messageKey } })
    } catch (e) {
      // Do not throw; just log for diagnostics
      console.warn(`[AUTO-REACT] Failed to send reaction ${emoji} for ${messageKey?.id || "?"}:`, e?.message || e)
    }
  }

  // Incoming messages -> attach "processing" reaction
  try {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return
        if (!Array.isArray(messages) || messages.length === 0) return

        for (const m of messages) {
          try {
            // Only react to user messages (not own messages)
            if (!m || !m.key || m.key.fromMe) continue
            if (!m.message) continue
            if (!m.key.remoteJid || m.key.remoteJid === "status@broadcast") continue

            // Avoid reacting to protocol/reaction messages to reduce loops
            const msgType = Object.keys(m.message)[0]
            if (msgType === "protocolMessage" || msgType === "reactionMessage") continue

            // Build unique key
            const pendingKey = buildPendingKey(m.key.remoteJid, m.key.id, m.key.participant)

            // If already pending, refresh timer (do not spam initial reaction)
            if (pendingReactions.has(pendingKey)) {
              const info = pendingReactions.get(pendingKey)
              try { clearTimeout(info.timeoutId) } catch (_) {}
              // set a new auto-complete timeout
              const tid = setTimeout(async () => {
                try {
                  await safeSendReaction(sock, m.key.remoteJid, m.key, REACT_DONE)
                } catch (_) {}
                pendingReactions.delete(pendingKey)
              }, AUTO_COMPLETE_MS)
              pendingReactions.set(pendingKey, { timeoutId: tid, createdAt: Date.now() })
              continue
            }

            // Send initial processing reaction (best-effort)
            await safeSendReaction(sock, m.key.remoteJid, m.key, REACT_PROCESSING)

            // Put into pending map with auto-complete fallback
            const tid = setTimeout(async () => {
              try {
                await safeSendReaction(sock, m.key.remoteJid, m.key, REACT_DONE)
              } catch (_) {}
              pendingReactions.delete(pendingKey)
            }, AUTO_COMPLETE_MS)

            pendingReactions.set(pendingKey, { timeoutId: tid, createdAt: Date.now() })
          } catch (inner) {
            // per-message safety
            console.warn("[AUTO-REACT] incoming loop error:", inner?.message || inner)
          }
        }
      } catch (e) {
        console.error("[AUTO-REACT] messages.upsert incoming handler error:", e?.message || e)
      }
    })
    console.log("[AUTO-REACT] Incoming reaction handler installed.")
  } catch (e) {
    console.warn("[AUTO-REACT] Failed to install incoming handler:", e?.message || e)
  }

  // Outgoing messages from bot -> when bot replies (quotes) to user's message, update reaction to done
  try {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return
        if (!Array.isArray(messages) || messages.length === 0) return

        for (const m of messages) {
          try {
            // Interested only in messages sent by the bot
            if (!m || !m.key || !m.key.fromMe) continue
            if (!m.message) continue
            if (!m.key.remoteJid || m.key.remoteJid === "status@broadcast") continue

            // Extract quoted stanzaId/participant from outgoing message's contextInfo (various shapes)
            const extractQuotedStanzaId = (msgObj) => {
              try {
                // extendedTextMessage.contextInfo.stanzaId
                const ext = msgObj?.extendedTextMessage?.contextInfo
                if (ext?.stanzaId) return { id: ext.stanzaId, participant: ext.participant }
                // image/video/audio/document when sent as reply may include contextInfo too
                const keys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]
                for (const k of keys) {
                  const node = msgObj[k]
                  if (node && node.contextInfo && node.contextInfo.stanzaId) {
                    return { id: node.contextInfo.stanzaId, participant: node.contextInfo.participant }
                  }
                }
                // sometimes quotedMessage is present
                const ctx = msgObj?.extendedTextMessage?.contextInfo
                if (ctx?.quotedMessage && ctx?.stanzaId) return { id: ctx.stanzaId, participant: ctx.participant }
              } catch (e) {}
              return null
            }

            // try many shapes within m.message
            let quotedInfo = null
            const msgTypes = Object.keys(m.message)
            for (const t of msgTypes) {
              const node = m.message[t]
              if (!node) continue
              quotedInfo = extractQuotedStanzaId(node)
              if (quotedInfo && quotedInfo.id) break
            }

            if (!quotedInfo || !quotedInfo.id) {
              // perhaps the bot used the 'quoted' option earlier; try top-level extendedTextMessage
              const topExt = m.message?.extendedTextMessage?.contextInfo
              if (topExt && topExt.stanzaId) quotedInfo = { id: topExt.stanzaId, participant: topExt.participant }
            }

            if (!quotedInfo || !quotedInfo.id) continue

            const pendingKey = buildPendingKey(m.key.remoteJid, quotedInfo.id, quotedInfo.participant)

            if (pendingReactions.has(pendingKey)) {
              // clear fallback timeout and send final reaction
              const info = pendingReactions.get(pendingKey)
              try { clearTimeout(info.timeoutId) } catch (_) {}

              // Build messageKey for the original message to update reaction
              const originalMessageKey = { remoteJid: m.key.remoteJid, id: quotedInfo.id, participant: quotedInfo.participant, fromMe: false }

              await safeSendReaction(sock, m.key.remoteJid, originalMessageKey, REACT_DONE)

              pendingReactions.delete(pendingKey)
            }
          } catch (inner) {
            console.warn("[AUTO-REACT] outgoing loop error:", inner?.message || inner)
          }
        }
      } catch (e) {
        console.error("[AUTO-REACT] messages.upsert outgoing handler error:", e?.message || e)
      }
    })
    console.log("[AUTO-REACT] Outgoing reply watcher installed.")
  } catch (e) {
    console.warn("[AUTO-REACT] Failed to install outgoing watcher:", e?.message || e)
  }

  // Optional: cleanup periodic maintenance (clear stale entries older than some threshold)
  try {
    setInterval(() => {
      const now = Date.now()
      for (const [k, v] of pendingReactions.entries()) {
        if (!v || !v.createdAt) continue
        if (now - v.createdAt > 5 * AUTO_COMPLETE_MS) {
          try { clearTimeout(v.timeoutId) } catch (_) {}
          pendingReactions.delete(k)
        }
      }
    }, AUTO_COMPLETE_MS)
  } catch (e) {
    // ignore
  }
}

  // END startBot
}

// Load auth state from file system (IMPROVED SESSION MANAGEMENT)
// ===================================================================
// Improvements:
// - Session lock to prevent concurrent starts (lock file with PID & timestamp).
// - Session age detection and archival: if session folder is older than SESSION_MAX_AGE_MS,
//   it will be archived to a timestamped folder (so a fresh auth is forced).
// - Safe removal / rename with cross-device fallback.
// - Robust flush of credentials on exit.
// - Single-instance guard (global.__h56_bot_running).
// - Configurable TTLs via constants below.

const SESSION_LOCK_FILE = path.join(SESSION_FOLDER, ".session-lock.json")
const SESSION_ARCHIVE_ROOT = path.resolve(path.join(path.dirname(SESSION_FOLDER), "session_archives"))
// How old a session must be before we consider it stale and archive it (default: 7 days)
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// If lock file is older than this, consider it stale (default: 1 day)
const SESSION_LOCK_TTL_MS = 24 * 60 * 60 * 1000 // 1 day
// Maximum attempts to acquire lock before failing fast
const SESSION_LOCK_RETRY = 3
const SESSION_LOCK_RETRY_DELAY_MS = 800

// Ensure archive dir exists
try {
  if (!fs.existsSync(SESSION_ARCHIVE_ROOT)) fs.mkdirSync(SESSION_ARCHIVE_ROOT, { recursive: true })
} catch (e) {
  console.warn("[SESSION] Could not ensure archive root:", e?.message || e)
}

// Helper: safely read JSON lock
const readLockFile = (lockPath) => {
  try {
    if (!fs.existsSync(lockPath)) return null
    const raw = fs.readFileSync(lockPath, "utf8")
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

// Helper: write JSON lock (atomic)
const writeLockFile = (lockPath, payload) => {
  try {
    const tmp = `${lockPath}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8")
    try { fs.renameSync(tmp, lockPath) } catch (e) { // cross-device fallback
      const data = fs.readFileSync(tmp)
      fs.writeFileSync(lockPath, data)
      try { fs.unlinkSync(tmp) } catch (_) {}
    }
    return true
  } catch (e) {
    console.warn("[SESSION] Failed to write lock file:", e?.message || e)
    return false
  }
}

// Helper: check if a process is alive
const isPidAlive = (pid) => {
  try {
    if (!pid) return false
    // On Windows process.kill(pid, 0) still throws if pid not found
    process.kill(Number(pid), 0)
    return true
  } catch (e) {
    return false
  }
}

// Helper: compute newest mtime inside folder (returns ms timestamp). If folder missing, return 0.
const latestMTimeOfFolder = (folder) => {
  try {
    if (!fs.existsSync(folder)) return 0
    const files = fs.readdirSync(folder)
    let latest = 0
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(folder, f))
        if (st && st.mtimeMs > latest) latest = st.mtimeMs
      } catch (e) {}
    }
    return latest
  } catch (e) {
    return 0
  }
}

// Helper: archive session folder by renaming it to session_archives/session_YYYYMMDD_HHMMSS_rand
const archiveSessionFolder = (folder) => {
  try {
    if (!fs.existsSync(folder)) return null
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const rand = Math.random().toString(36).slice(2, 8)
    const dest = path.join(SESSION_ARCHIVE_ROOT, `session_${ts}_${rand}`)
    try {
      fs.renameSync(folder, dest)
    } catch (e) {
      // fallback: copy recursively then remove
      const copyRecursiveSync = (src, dst) => {
        if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
        const entries = fs.readdirSync(src, { withFileTypes: true })
        for (const ent of entries) {
          const srcPath = path.join(src, ent.name)
          const dstPath = path.join(dst, ent.name)
          if (ent.isDirectory()) copyRecursiveSync(srcPath, dstPath)
          else fs.copyFileSync(srcPath, dstPath)
        }
      }
      try {
        copyRecursiveSync(folder, dest)
        // remove original folder recursively (best-effort)
        const rimrafSync = (p) => {
          if (!fs.existsSync(p)) return
          for (const f of fs.readdirSync(p)) {
            const child = path.join(p, f)
            const st = fs.statSync(child)
            if (st.isDirectory()) rimrafSync(child)
            else try { fs.unlinkSync(child) } catch (_) {}
          }
          try { fs.rmdirSync(p) } catch (_) {}
        }
        rimrafSync(folder)
      } catch (innerErr) {
        console.warn("[SESSION] Archive fallback failed:", innerErr?.message || innerErr)
        return null
      }
    }
    return dest
  } catch (e) {
    console.warn("[SESSION] archiveSessionFolder failed:", e?.message || e)
    return null
  }
}

// Acquire session lock (best-effort). Returns true if acquired.
const acquireSessionLock = () => {
  for (let attempt = 0; attempt < SESSION_LOCK_RETRY; attempt++) {
    try {
      const existing = readLockFile(SESSION_LOCK_FILE)
      if (existing) {
        // if existing PID alive and recent, then cannot acquire
        const age = Date.now() - (existing.startedAt || 0)
        if (existing.pid && isPidAlive(existing.pid) && age < SESSION_LOCK_TTL_MS) {
          // Active lock held by live process - fail immediately
          console.warn(`[SESSION] Lock held by pid ${existing.pid} (age ${(age/1000).toFixed(0)}s)`)
          return false
        }
        // Stale lock: check if stale by TTL or pid dead
        if (!existing.pid || !isPidAlive(existing.pid) || (Date.now() - (existing.startedAt || 0)) > SESSION_LOCK_TTL_MS) {
          // remove stale lock and try to acquire
          try { fs.unlinkSync(SESSION_LOCK_FILE) } catch (_) {}
        }
      }

      // write our lock
      const payload = { pid: process.pid, startedAt: Date.now(), nodeVersion: process.version }
      const ok = writeLockFile(SESSION_LOCK_FILE, payload)
      if (!ok) {
        // minor delay then retry
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SESSION_LOCK_RETRY_DELAY_MS)
        continue
      }
      // verify lock content is ours
      const verify = readLockFile(SESSION_LOCK_FILE)
      if (verify && Number(verify.pid) === process.pid) {
        console.log(`[SESSION] Acquired session lock (pid=${process.pid})`)
        return true
      } else {
        // someone else raced us; retry a bit
        try { fs.unlinkSync(SESSION_LOCK_FILE) } catch (_) {}
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SESSION_LOCK_RETRY_DELAY_MS)
        continue
      }
    } catch (e) {
      console.warn("[SESSION] acquireSessionLock attempt failed:", e?.message || e)
      try { fs.unlinkSync(SESSION_LOCK_FILE) } catch (_) {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SESSION_LOCK_RETRY_DELAY_MS)
    }
  }
  return false
}

// Release session lock
const releaseSessionLock = () => {
  try {
    const existing = readLockFile(SESSION_LOCK_FILE)
    if (existing && Number(existing.pid) !== process.pid) {
      // Not our lock; do nothing
      return
    }
    if (fs.existsSync(SESSION_LOCK_FILE)) fs.unlinkSync(SESSION_LOCK_FILE)
    console.log("[SESSION] Released session lock")
  } catch (e) {
    console.warn("[SESSION] Failed to release lock:", e?.message || e)
  }
}

// Improved loadAuthState which archives stale session folder before calling useMultiFileAuthState
const loadAuthState = async () => {
  try {
    // Guard: ensure session lock acquired so multiple starts don't race
    const locked = acquireSessionLock()
    if (!locked) {
      // If cannot acquire lock, fail fast — helpful for operators to detect duplicate instances
      throw new Error("Unable to acquire session lock. Another instance may be running or a stale lock exists.")
    }

    // Ensure directory exists (useMultiFileAuthState will create files, but ensure base exists)
    const resolved = path.resolve(SESSION_FOLDER)
    try {
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true })
    } catch (e) {
      console.warn("[AUTH] Could not create session folder:", e?.message || e)
    }

    // Detect age of existing session and archive if stale
    try {
      const latest = latestMTimeOfFolder(resolved)
      if (latest > 0) {
        const age = Date.now() - latest
        if (age > SESSION_MAX_AGE_MS) {
          console.log(`[SESSION] Session folder appears stale (last-modified ${(age/1000/60/60).toFixed(1)}h). Archiving before fresh auth.`)
          const archived = archiveSessionFolder(resolved)
          if (archived) {
            console.log(`[SESSION] Existing session archived to: ${archived}`)
            // Recreate session folder empty for new credentials
            try { fs.mkdirSync(resolved, { recursive: true }) } catch (e) {}
          } else {
            console.warn("[SESSION] Archival failed; continuing with existing session folder (best-effort).")
          }
        }
      }
    } catch (e) {
      console.warn("[SESSION] session staleness check failed:", e?.message || e)
    }

    // Call original useMultiFileAuthState to get state/saveCreds
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER)

    // Wrap saveCreds to provide safe flush and small logging, as before
    const safeSaveCreds = async (maybeCreds) => {
      try {
        await saveCreds(maybeCreds)
        console.log("[AUTH] Credentials flushed to disk.")
      } catch (e) {
        console.error("[AUTH] saveCreds failed:", e?.message || e)
      }
    }

    // store to global authState used elsewhere
    authState = {
      state,
      saveCreds: safeSaveCreds,
      sessionFolder: resolved,
    }

    // Ensure we flush credentials on process exit signals (best-effort) and release lock
    const flushAndExit = async (signal) => {
      try {
        console.log(`[AUTH] Process exiting (${signal}). Attempting to flush credentials and release session lock...`)
        if (authState && typeof authState.saveCreds === "function") {
          try { await authState.saveCreds() } catch (e) {}
        }
      } catch (e) {
        console.warn("[AUTH] Flush on exit failed:", e?.message || e)
      } finally {
        // release lock and allow process to exit naturally
        try { releaseSessionLock() } catch (_) {}
      }
    }

    // Register exit handlers only once
    if (!global.__h56_auth_exit_handlers_installed) {
      process.once("SIGINT", () => flushAndExit("SIGINT").then(() => process.exit(0)))
      process.once("SIGTERM", () => flushAndExit("SIGTERM").then(() => process.exit(0)))
      process.once("beforeExit", () => flushAndExit("beforeExit"))
      global.__h56_auth_exit_handlers_installed = true
      console.log("[AUTH] Exit handlers for credential flush & lock release installed.")
    }

    return authState
  } catch (err) {
    // On any failure: ensure lock released and rethrow so caller can decide
    try { releaseSessionLock() } catch (_) {}
    console.error("[AUTH] loadAuthState error:", err?.message || err)
    // Set a safe fallback authState to avoid null references elsewhere (but still throw to surface failure)
    authState = authState || { state: undefined, saveCreds: async () => {} }
    throw err
  }
}
// loadAuthState

// Entry point with proper session safety and single-instance guard
const main = async () => {
  try {
    // Single-instance guard in-process (helpful for some restart flows)
    if (global.__h56_bot_running) {
      console.log("[MAIN] Another bot instance already running in this process. Exiting.")
      return
    }
    global.__h56_bot_running = true

    // Load auth state (acquire session lock inside)
    await loadAuthState()

    // Load access mode early
    BOT_ACCESS_MODE = loadAccessMode()

    // Start main bot logic
    await startBot()
  } catch (err) {
    console.error("Bot initialization error:", err?.message || err)
    // On failure to load auth state (e.g., lock held) provide helpful hint for operator
    if (err && String(err.message || "").toLowerCase().includes("lock")) {
      console.error("[MAIN] Session lock prevented startup. If no other bot instance is running, remove:", SESSION_LOCK_FILE)
    }
    // Release lock at the end to avoid orphan lock lingering if startup failed
    try { releaseSessionLock() } catch (_) {}
    process.exit(1)
  }
}

main()