import axios from "axios"
import { scrapeUser } from "h56-github-scrapper"

const DEFAULT_AVATAR_TIMEOUT = 12_000

// parse fuzzy numeric strings like "1.2k", "3M", "1234" into integer
const parseFuzzyNumber = (v) => {
  try {
    if (v == null) return 0
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v)
    let s = String(v).trim().toLowerCase()
    if (!s) return 0
    // remove commas
    s = s.replace(/,/g, "")
    // 1.2k, 3.4m, etc.
    const match = s.match(/^([\d,.]+)\s*([km])?$/i)
    if (match) {
      let num = parseFloat(match[1].replace(/,/g, ""))
      const suffix = (match[2] || "").toLowerCase()
      if (suffix === "k") num = num * 1_000
      if (suffix === "m") num = num * 1_000_000
      return Math.round(num)
    }
    // fallback parseInt
    const n = parseInt(s.replace(/[^\d]/g, ""), 10)
    return Number.isFinite(n) ? n : 0
  } catch (e) {
    return 0
  }
}

export default async function githubSearchHandler(sock, msg, username, opts = {}) {
  const {
    encodeUnicodeText = (t) => (typeof t === "string" ? t : String(t)),
    logger = console,
  } = opts

  const from = msg?.key?.remoteJid || null

  const safeSendText = async (text) => {
    try {
      if (!from) return
      await sock.sendMessage(from, { text: encodeUnicodeText(text) }, { quoted: msg })
    } catch (e) {
      try { logger?.error?.("[GITHUB] sendText failed:", e?.message || e) } catch (_) {}
    }
  }

  const raw = String(username || "").trim()
  if (!raw) {
    await safeSendText("Format: .githubsearch <username>\nContoh: .githubsearch torvalds")
    return
  }

  // basic username validation (same as original)
  const validUsername = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
  if (!validUsername.test(raw) || raw.length > 39) {
    await safeSendText("Username GitHub tidak valid. Pastikan hanya menggunakan huruf, angka, dan tanda '-' (tidak diawal/akhir). Contoh: torvalds")
    return
  }

  const uname = raw

  try {
    await sock.sendMessage(from, { text: encodeUnicodeText(`🔎 Mencari profil GitHub untuk: ${uname} — mohon tunggu...`) }, { quoted: msg })
  } catch (_) {}

  try {
    // scrapeUser returns { profile, stats, repos }
    const result = await scrapeUser(uname, { spinner: false })

    if (!result || !result.profile || !result.profile.username) {
      await safeSendText(`❌ Gagal mengambil data untuk '${uname}'. Username mungkin tidak ditemukan.`)
      logger?.warn?.("[GITHUB] scrapeUser returned empty for", uname, result)
      return
    }

    const profile = result.profile || {}
    const stats = result.stats || {}
    const repos = Array.isArray(result.repos) ? result.repos : []

    // Robust extraction of fields (handle multiple possible keys)
    const displayName = profile.name || profile.full_name || profile.displayName || "-"
    const bio = profile.bio || profile.description || "-"
    const location = profile.location || profile.homeLocation || "-"
    const profileUrl = profile.profile || profile.profile_url || profile.url || `https://github.com/${uname}`
    const avatarUrl = profile.avatar || profile.avatar_url || profile.avatarUrl || null

    // followers/following often live on profile; some scrapers put them in stats.
    const followers = parseFuzzyNumber(profile.followers ?? profile.followers_count ?? stats.followers ?? stats.followers_count ?? 0)
    const following = parseFuzzyNumber(profile.following ?? profile.following_count ?? stats.following ?? stats.following_count ?? 0)

    // public repos: prefer stats, then profile.public_repos, then repos.length
    const publicRepos = parseFuzzyNumber(
      stats.public_repos ??
      stats.repos ??
      profile.public_repos ??
      profile.public_repos_count ??
      repos.length ??
      0,
    )

    // Build top repositories list (sort by stars, robust mapping)
    const topRepos = repos
      .map((r) => {
        // r may have different shapes: { name, repo, full_name, url, repo_url, description, repo_description, stars, stargazers_count }
        const name = r.name || r.repo || r.full_name || (typeof r.url === "string" ? r.url.split("/").pop() : "unknown")
        const description = (r.description || r.repo_description || r.summary || "").trim()
        const stars = parseFuzzyNumber(r.stars ?? r.stargazers_count ?? r.stargazers ?? 0)
        const forks = parseFuzzyNumber(r.forks ?? r.fork_count ?? r.forks_count ?? 0)
        const language = r.language || r.lang || r.primary_language || "-"
        const url = r.url || r.repo_url || (r.full_name ? `https://github.com/${r.full_name}` : (r.html_url || null))
        return { name, description, stars, forks, language, url }
      })
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 5)

    // Compose message
    const lines = []
    lines.push("💻 GitHub — Profil Pengguna")
    lines.push("────────────────────────────────")
    lines.push(`👤 Username : ${profile.username || uname}`)
    lines.push(`📝 Nama     : ${displayName}`)
    lines.push(`💬 Bio      : ${bio}`)
    if (location && location !== "-") lines.push(`📍 Lokasi   : ${location}`)
    lines.push(`📦 Repos publik : ${publicRepos}`)
    lines.push(`👥 Followers   : ${followers}   •   ➡ Following: ${following}`)
    lines.push("")
    lines.push(`🔗 Profil   : ${profileUrl}`)
    lines.push("")

    if (topRepos.length > 0) {
      lines.push("🏆 Top repositories:")
      for (const r of topRepos) {
        const shortDesc = r.description ? ` — ${r.description}` : ""
        const lang = r.language && r.language !== "-" ? ` (${r.language})` : ""
        const repoUrl = r.url || `https://github.com/${profile.username || uname}/${r.name}`
        lines.push(`• ${r.name}${lang} ⭐${r.stars} • Forks:${r.forks}${shortDesc}\n  ${repoUrl}`)
      }
    } else {
      lines.push("🏷 Repos    : Tidak ada repositori publik atau data repositori tidak tersedia.")
    }

    lines.push("")
    lines.push("Catatan: beberapa data diambil dari scraping profil publik GitHub. Jika informasi tidak lengkap, coba kunjungi profil langsung.")
    const messageText = lines.join("\n")

    // Send avatar if available
    if (avatarUrl) {
      try {
        const resp = await axios.get(String(avatarUrl), { responseType: "arraybuffer", timeout: DEFAULT_AVATAR_TIMEOUT })
        const buffer = Buffer.from(resp.data)
        try {
          await sock.sendMessage(from, { image: buffer, caption: encodeUnicodeText(`👤 ${displayName} — @${profile.username || uname}`) }, { quoted: msg })
        } catch (e) {
          logger?.warn?.("[GITHUB] failed to send avatar image (continue to send text):", e?.message || e)
        }
      } catch (e) {
        logger?.warn?.("[GITHUB] avatar download failed:", e?.message || e)
      }
    }

    // Send text summary
    await sock.sendMessage(from, { text: encodeUnicodeText(messageText) }, { quoted: msg })
    logger?.info?.(`[GITHUB] Sent profile for ${uname} to ${from}`)
  } catch (err) {
    logger?.error?.("[GITHUB] Error while scraping:", err && (err.message || err.toString()) ? (err.message || err.toString()) : String(err), err)

    const emsg = (err && (err.message || err?.cause?.message)) || String(err)

    if (/Not Found|404|username not found/i.test(emsg)) {
      await safeSendText(`❌ Username '${uname}' tidak ditemukan di GitHub.`)
      return
    }

    if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|Network Error/i.test(emsg)) {
      await safeSendText(`❌ Gagal mengambil data untuk '${uname}'. Terjadi masalah koneksi jaringan. Silakan coba lagi nanti.`)
      return
    }

    // generic fallback
    await safeSendText(`❌ Gagal mengambil data untuk '${uname}'. Username mungkin tidak ditemukan atau terjadi masalah koneksi.`)
  }
}