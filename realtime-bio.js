/**
 * realtime-bio.js
 *
 * Helper modular untuk memperbarui WhatsApp "About" / profile status dengan realtime runtime.
 * - Non-intrusive: cukup import dan panggil dari index.js.
 * - Menghindari spam: mendeduplikasi status yang sama dan menahan frekuensi update.
 * - Mengembalikan handle interval (NodeJS.Timeout) yang memiliki metode .stop() untuk menghentikan updater.
 *
 * Usage:
 *   import startRealtimeBioUpdater from './realtime-bio.js'
 *   bioInterval = startRealtimeBioUpdater(sock, {
 *     getStartTime: () => BOT_START_TIME,
 *     formatRuntime: formatRuntime, // optional
 *     intervalMs: 1000,
 *     logger: console
 *   })
 */

export default function startRealtimeBioUpdater(sock, {
  getStartTime,
  formatRuntime,
  intervalMs = 1000,
  logger = console,
} = {}) {
  if (!sock || typeof sock !== "object") {
    throw new Error("startRealtimeBioUpdater: requires a Baileys socket instance as first argument.")
  }
  if (typeof getStartTime !== "function") {
    throw new Error("startRealtimeBioUpdater: requires getStartTime() function that returns the bot start timestamp (ms).")
  }

  // Fallback runtime formatter
  const defaultFormatRuntime = (ms) => {
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

  const fmt = typeof formatRuntime === "function" ? formatRuntime : defaultFormatRuntime

  if (typeof intervalMs !== "number" || !isFinite(intervalMs) || intervalMs < 250) {
    intervalMs = 1000
  }

  if (typeof sock.updateProfileStatus !== "function") {
    logger && logger.warn && logger.warn("[REALTIME BIO] sock.updateProfileStatus not available. Realtime bio disabled.")
    return null
  }

  let lastStatus = null
  let stopped = false

  const buildStatus = () => {
    const start = Number(getStartTime()) || Date.now()
    const runtime = fmt(Date.now() - start)
    // Short, professional about text
    return `🤖 H56 Whatsapp Bot | Runtime: ${runtime}`
  }

  const doUpdate = async () => {
    if (stopped) return
    try {
      const statusText = buildStatus()
      if (statusText === lastStatus) return
      await sock.updateProfileStatus(statusText)
      lastStatus = statusText
      logger && logger.debug && logger.debug("[REALTIME BIO] Updated about:", statusText)
    } catch (err) {
      // Log but do not throw; typical transient errors or rate limits can occur
      logger && logger.warn && logger.warn("[REALTIME BIO] Failed to update about:", err?.message || err)
    }
  }

  // Immediate initial update (best-effort)
  doUpdate().catch((e) => {
    logger && logger.warn && logger.warn("[REALTIME BIO] Immediate update error:", e?.message || e)
  })

  // Start interval
  const interval = setInterval(() => {
    // Fire-and-forget to avoid awaiting inside interval
    doUpdate().catch(() => {})
  }, intervalMs)

  // Attach stop helper
  interval.stop = () => {
    if (!stopped) {
      stopped = true
      try { clearInterval(interval) } catch (e) {}
      logger && logger.debug && logger.debug("[REALTIME BIO] Stopped realtime about updater.")
    }
  }

  return interval
}