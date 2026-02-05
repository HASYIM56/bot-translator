import fs from "fs"
import path from "path"

export default async function registerBlock(sock, opts = {}) {
  const {
    CONFIG_FOLDER = "./config",
    BLOCKED_FILE = path.join(CONFIG_FOLDER, "blocked-user.json"),
    OWNER_NUMBER = "",
    isUserOwner = () => false,
    normalizeNumber = (n) => (n || "").toString().replace(/\D/g, ""),
    logger = console,
    encodeUnicodeText = (t) => (typeof t === "string" ? t : String(t)),
  } = opts

  // Helper logger wrappers
  const info = (...a) => { try { logger?.info?.(...a) } catch { console.log(...a) } }
  const warn = (...a) => { try { logger?.warn?.(...a) } catch { console.warn(...a) } }
  const error = (...a) => { try { logger?.error?.(...a) } catch { console.error(...a) } }

  // Ensure config folder exists
  try {
    if (!fs.existsSync(CONFIG_FOLDER)) fs.mkdirSync(CONFIG_FOLDER, { recursive: true })
  } catch (e) {
    error("[BLOCK] Failed to ensure config folder:", e?.message || e)
  }

  // Atomic write helper (write to tmp then rename)
  const atomicWriteFile = (targetPath, data) => {
    try {
      const dir = path.dirname(targetPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`)
      fs.writeFileSync(tmp, data, { encoding: "utf8" })
      // rename (atomic on most OS)
      fs.renameSync(tmp, targetPath)
      return true
    } catch (e) {
      error("[BLOCK] atomicWriteFile failed:", e?.message || e)
      try {
        // fallback: direct write
        fs.writeFileSync(targetPath, data, { encoding: "utf8" })
        return true
      } catch (e2) {
        error("[BLOCK] fallback write failed:", e2?.message || e2)
        return false
      }
    }
  }

  // Ensure blocked file exists and is valid JSON
  const ensureBlockedFile = () => {
    try {
      if (!fs.existsSync(BLOCKED_FILE)) {
        const initial = { blocked: [], updatedAt: new Date().toISOString() }
        atomicWriteFile(BLOCKED_FILE, JSON.stringify(initial, null, 2))
        info(`[BLOCK] Created blocked file at ${BLOCKED_FILE}`)
        return
      }
      // If exists but invalid JSON, repair
      try {
        const raw = fs.readFileSync(BLOCKED_FILE, "utf8") || ""
        JSON.parse(raw || "{}")
      } catch (e) {
        warn("[BLOCK] blocked-user.json invalid JSON, repairing.")
        const initial = { blocked: [], updatedAt: new Date().toISOString() }
        atomicWriteFile(BLOCKED_FILE, JSON.stringify(initial, null, 2))
      }
    } catch (e) {
      error("[BLOCK] ensureBlockedFile error:", e?.message || e)
    }
  }

  ensureBlockedFile()

  // Utility: normalize a value into full JID (e.g., "62812..." or "62812...@s.whatsapp.net")
  const toFullJid = (input) => {
    if (!input) return ""
    const s = String(input).trim()
    if (s.includes("@")) return s
    const normalized = normalizeNumber(s)
    if (!normalized) return ""
    return `${normalized}@s.whatsapp.net`
  }

  // Load blocked list robustly (support several formats)
  const loadBlockedListFromFile = () => {
    try {
      if (!fs.existsSync(BLOCKED_FILE)) return []
      const raw = fs.readFileSync(BLOCKED_FILE, "utf8") || "{}"
      const parsed = JSON.parse(raw)
      let arr = []
      if (!parsed) return []
      if (Array.isArray(parsed)) arr = parsed
      else if (Array.isArray(parsed.blocked)) arr = parsed.blocked
      else {
        // Coerce any nested arrays or values
        const vals = Object.values(parsed).flat().filter(Boolean)
        arr = Array.isArray(vals) ? vals : []
      }
      // Normalize entries to full JID
      const normalized = arr.map((v) => toFullJid(v)).filter(Boolean)
      return Array.from(new Set(normalized))
    } catch (e) {
      warn("[BLOCK] loadBlockedListFromFile error:", e?.message || e)
      return []
    }
  }

  // Save blocked list atomically
  const saveBlockedListToFile = (arr) => {
    try {
      const payload = { blocked: Array.from(new Set(arr)).filter(Boolean), updatedAt: new Date().toISOString() }
      const ok = atomicWriteFile(BLOCKED_FILE, JSON.stringify(payload, null, 2))
      if (ok) info(`[BLOCK] Persisted blocked list (${payload.blocked.length} entries) to ${BLOCKED_FILE}`)
      return ok
    } catch (e) {
      error("[BLOCK] saveBlockedListToFile error:", e?.message || e)
      return false
    }
  }

  // In-memory set for fast lookup
  let blockedSet = new Set(loadBlockedListFromFile())

  // Helpers: add/remove/check
  const addBlocked = (raw) => {
    try {
      const jid = toFullJid(String(raw || "").trim())
      if (!jid) return false
      if (blockedSet.has(jid)) return false
      blockedSet.add(jid)
      saveBlockedListToFile(Array.from(blockedSet))
      return true
    } catch (e) {
      error("[BLOCK] addBlocked error:", e?.message || e)
      return false
    }
  }

  const removeBlocked = (raw) => {
    try {
      const jid = toFullJid(String(raw || "").trim())
      if (!jid) return false
      if (!blockedSet.has(jid)) return false
      blockedSet.delete(jid)
      saveBlockedListToFile(Array.from(blockedSet))
      return true
    } catch (e) {
      error("[BLOCK] removeBlocked error:", e?.message || e)
      return false
    }
  }

  const isBlocked = (raw) => {
    try {
      const jid = toFullJid(String(raw || "").trim())
      if (!jid) return false
      return blockedSet.has(jid)
    } catch (e) {
      return false
    }
  }

  // Recent message map for quoted->author lookup
  const recentMsgMap = new Map()
  const RECENT_TTL_MS = 1000 * 60 * 15 // 15 minutes
  const cleanupRecent = () => {
    const now = Date.now()
    for (const [k, v] of recentMsgMap.entries()) {
      if (!v || !v.ts || now - v.ts > RECENT_TTL_MS) recentMsgMap.delete(k)
    }
  }
  const cleanupInterval = setInterval(() => { try { cleanupRecent() } catch (e) {} }, 1000 * 60 * 5)

  // Safe accessor for message key IDs across different shapes
  const extractStanzaIdFromKey = (key) => {
    if (!key) return null
    return key.id || key.stanzaId || null
  }

  // Register messages.upsert to populate recentMsgMap and watch for commands as fallback
  if (sock && sock.ev && typeof sock.ev.on === "function") {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (!Array.isArray(messages) || messages.length === 0) return
        for (const m of messages) {
          try {
            if (!m || !m.key) continue
            // Skip status updates
            if (m.key.remoteJid === "status@broadcast") continue

            // Map stanzaId -> sender
            const stanzaId = extractStanzaIdFromKey(m.key)
            // Determine senderJid robustly
            let senderJid = ""
            const remote = m.key.remoteJid || ""
            if (remote.endsWith("@g.us")) {
              senderJid = m.key.participant || (m.message?.extendedTextMessage?.contextInfo?.participant) || remote
            } else {
              senderJid = remote
            }
            if (stanzaId && senderJid) {
              recentMsgMap.set(stanzaId, { senderJid, ts: Date.now(), remoteJid: remote })
            }
          } catch (e) {
            // ignore per-message errors
          }
        }

        // Fallback: also detect .block/.unblock typed by main owner (in case updateBlockStatus patch didn't run)
        try {
          const msg = messages[0]
          if (!msg || !msg.message) return
          const from = msg.key.remoteJid
          if (from === "status@broadcast") return

          const isGroup = (from || "").endsWith("@g.us")
          const sender = isGroup ? msg.key.participant || from : from
          const senderNumber = String(sender).split("@")[0]
          const mainOwnerNormalized = normalizeNumber(OWNER_NUMBER)
          const senderNormalized = normalizeNumber(senderNumber)
          const isMainOwner = senderNormalized === mainOwnerNormalized

          if (!isMainOwner) return

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
          const args = text.trim().split(" ")
          const cmd = args[0].toLowerCase()
          if (cmd !== ".block" && cmd !== ".unblock") return

          // Determine target JID: prefer mentionedJid, then context.participant, then numeric arg
          const context = msg.message?.extendedTextMessage?.contextInfo
          const mentioned = context?.mentionedJid || []
          let targetJid = null
          if (mentioned && mentioned.length > 0) targetJid = mentioned[0]
          else if (context?.participant) targetJid = context.participant
          else if (args[1]) {
            const possible = args[1].trim()
            const normalized = normalizeNumber(possible)
            if (normalized && normalized.length > 5) targetJid = `${normalized}@s.whatsapp.net`
          }
          if (!targetJid) return

          if (cmd === ".block") {
            const added = addBlocked(targetJid)
            if (added) info(`[BLOCK] Persisted block for ${targetJid} (via messages.upsert fallback)`)
            else info(`[BLOCK] ${targetJid} already blocked (messages.upsert fallback)`)
          } else {
            const removed = removeBlocked(targetJid)
            if (removed) info(`[BLOCK] Persisted unblock for ${targetJid} (via messages.upsert fallback)`)
            else info(`[BLOCK] ${targetJid} not found in blocked list (messages.upsert fallback)`)
          }
        } catch (e) {
          // swallow fallback errors
          warn("[BLOCK] fallback messages.upsert processing error:", e?.message || e)
        }
      } catch (e) {
        warn("[BLOCK] messages.upsert handler error:", e?.message || e)
      }
    })
    info("[BLOCK] messages.upsert listener registered.")
  } else {
    warn("[BLOCK] sock.ev.on not available; messages.upsert listener not registered.")
  }

  // Monkey-patch sock.sendMessage to suppress replies to blocked users in GROUPS (best-effort)
  try {
    if (sock && typeof sock.sendMessage === "function") {
      const originalSendMessage = sock.sendMessage.bind(sock)

      sock.sendMessage = async (jid, message, options = {}) => {
        try {
          // Helper to attempt to extract quoted stanza id from options or message
          const getQuotedStanzaId = (msgObj, opts) => {
            // 1) options.quoted may be full quoted message object or { key: { id } }
            if (opts && opts.quoted) {
              const q = opts.quoted
              if (q?.key?.id) return q.key.id
              if (q?.contextInfo?.stanzaId) return q.contextInfo.stanzaId
              if (q?.key?.stanzaId) return q.key.stanzaId
            }
            // 2) message.contextInfo.stanzaId
            if (msgObj && msgObj.contextInfo && msgObj.contextInfo.stanzaId) return msgObj.contextInfo.stanzaId
            // 3) message.quoted, old shapes
            if (msgObj && msgObj.quoted && msgObj.quoted.key && msgObj.quoted.key.id) return msgObj.quoted.key.id
            return null
          }

          const quotedStanzaId = getQuotedStanzaId(message, options)
          if (quotedStanzaId) {
            const rec = recentMsgMap.get(quotedStanzaId)
            if (rec && rec.senderJid) {
              const targetIsGroup = String(jid || "").endsWith("@g.us")
              if (targetIsGroup && blockedSet.has(String(rec.senderJid))) {
                info(`[BLOCK] Suppressed reply to blocked user ${rec.senderJid} in group ${jid}`)
                // Return a stubbed response mimicking success
                return Promise.resolve({ key: { id: `blocked_${Date.now()}`, remoteJid: jid, fromMe: true } })
              }
            }
          }

          // No suppression: call original
          return originalSendMessage(jid, message, options)
        } catch (e) {
          // If anything fails, fallback to original sendMessage
          try {
            return originalSendMessage(jid, message, options)
          } catch (inner) {
            throw inner
          }
        }
      }

      info("[BLOCK] sendMessage monkey-patch installed (suppresses replies to blocked users in groups).")
    } else {
      warn("[BLOCK] sock.sendMessage not available; sendMessage patch not installed.")
    }
  } catch (e) {
    error("[BLOCK] Failed to patch sendMessage:", e?.message || e)
  }

  // Monkey-patch updateBlockStatus and updateBlocklist to observe official block actions and persist them
  try {
    // Patch updateBlockStatus(jid, action)
    if (sock && typeof sock.updateBlockStatus === "function") {
      const origUpdateBlockStatus = sock.updateBlockStatus.bind(sock)
      sock.updateBlockStatus = async (...args) => {
        try {
          const result = await origUpdateBlockStatus(...args)
          try {
            // args may be (jid, "block") or (jid, "unblock") or (jid) depending on version
            const target = args[0]
            const actionArg = args[1]
            const targetJid = toFullJid(target)
            if (targetJid) {
              if (String(actionArg || "").toLowerCase() === "block" || String(actionArg || "").toLowerCase() === "true") {
                addBlocked(targetJid)
              } else if (String(actionArg || "").toLowerCase() === "unblock" || String(actionArg || "").toLowerCase() === "false") {
                removeBlocked(targetJid)
              } else {
                // If only one arg, assume it's block (best-effort) — do not assume; instead do nothing
              }
            }
          } catch (e) {
            warn("[BLOCK] updateBlockStatus persistence error:", e?.message || e)
          }
          return result
        } catch (e) {
          // Re-throw to preserve original behavior when failing
          throw e
        }
      }
      info("[BLOCK] Patched sock.updateBlockStatus to persist block/unblock.")
    } else {
      warn("[BLOCK] sock.updateBlockStatus not present; patch skipped.")
    }

    // Patch updateBlocklist - many versions have different signatures; handle common ones
    if (sock && typeof sock.updateBlocklist === "function") {
      const origUpdateBlocklist = sock.updateBlocklist.bind(sock)
      sock.updateBlocklist = async (...args) => {
        try {
          const result = await origUpdateBlocklist(...args)
          try {
            // Interpret args smartly:
            // - updateBlocklist([jid1, jid2], true) -> block list add
            // - updateBlocklist(jid, true) -> block single
            // - updateBlocklist([jid], false) -> unblock
            const first = args[0]
            const second = args[1]
            const shouldBlock = (typeof second === "boolean") ? second : String(second || "").toLowerCase() === "block" || String(second || "").toLowerCase() === "true"
            const targets = Array.isArray(first) ? first : [first]
            for (const t of targets) {
              const tj = toFullJid(t)
              if (!tj) continue
              if (shouldBlock) addBlocked(tj)
              else removeBlocked(tj)
            }
          } catch (e) {
            warn("[BLOCK] updateBlocklist persistence error:", e?.message || e)
          }
          return result
        } catch (e) {
          throw e
        }
      }
      info("[BLOCK] Patched sock.updateBlocklist to persist block/unblock.")
    } else {
      warn("[BLOCK] sock.updateBlocklist not present; patch skipped.")
    }
  } catch (e) {
    warn("[BLOCK] Failed to patch block-list methods:", e?.message || e)
  }

  // Attach blockManager helpers to sock
  try {
    if (!sock.blockManager) sock.blockManager = {}
    sock.blockManager.isBlocked = (x) => isBlocked(x)
    sock.blockManager.addBlocked = (x) => addBlocked(x)
    sock.blockManager.removeBlocked = (x) => removeBlocked(x)
    sock.blockManager.listBlocked = () => Array.from(blockedSet)
    sock.blockManager.blockedFile = BLOCKED_FILE
    info("[BLOCK] sock.blockManager attached (isBlocked, addBlocked, removeBlocked, listBlocked).")
  } catch (e) {
    warn("[BLOCK] Could not attach blockManager to sock:", e?.message || e)
  }

  // Graceful cleanup on connection close/logout
  if (sock && sock.ev && typeof sock.ev.on === "function") {
    sock.ev.on("connection.update", (update) => {
      try {
        const { connection } = update
        if (connection === "close" || connection === "logout") {
          try { clearInterval(cleanupInterval) } catch (_) {}
        }
      } catch (e) {}
    })
  }

  // Return programmatic API
  return {
    isBlocked,
    addBlocked,
    removeBlocked,
    listBlocked: () => Array.from(blockedSet),
    blockedFile: BLOCKED_FILE,
  }
}