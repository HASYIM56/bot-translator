import fs from "fs"
import path from "path"
import os from "os"

// ======================
// QR CODE GENERATOR MODULE
// ======================

// Permanent base media directory and qrcode folder (per request)
const BASE_MEDIA_DIR = path.join(path.sep, "HASYIM56")
const QRCODE_FOLDER = path.join(BASE_MEDIA_DIR, "qrcode")

// Ensure qrcode folder exists (best-effort)
try {
  if (!fs.existsSync(BASE_MEDIA_DIR)) {
    fs.mkdirSync(BASE_MEDIA_DIR, { recursive: true })
  }
  if (!fs.existsSync(QRCODE_FOLDER)) {
    fs.mkdirSync(QRCODE_FOLDER, { recursive: true })
  }
} catch (e) {
  // best-effort; do not alter behavior if cannot create
  console.warn("[QRCODE] Failed to ensure permanent qrcode folder:", e?.message || e)
}

/**
 * Generate QR Code from text or URL using external API
 * @param {string} data - Text or URL to encode
 * @returns {Promise<Object>} - Response object with QR Code data
 */
export const generateQRCode = async (data) => {
  if (!data || typeof data !== "string" || data.trim().length === 0) {
    throw new Error("Data tidak boleh kosong")
  }

  try {
    console.log(`[QRCODE] Generating QR Code for: ${data}`)

    const response = await fetch("https://h56-qr-generator-api.netlify.app/api/qr_scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: data.trim(),
      }),
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()

    // Validate response structure
    if (!result.success || !result.qr_data_url) {
      throw new Error("Invalid API response: missing qr_data_url")
    }

    // Save a copy of the QR image to permanent qrcode folder (non-intrusive: does not change return value)
    try {
      const dataUrl = result.qr_data_url
      const commaIndex = dataUrl.indexOf(",")
      if (commaIndex > -1) {
        const meta = dataUrl.slice(0, commaIndex)
        const base64String = dataUrl.slice(commaIndex + 1)
        const buffer = Buffer.from(base64String, "base64")
        const filename = `qrcode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
        const filepath = path.join(QRCODE_FOLDER, filename)
        try {
          fs.writeFileSync(filepath, buffer)
          console.log(`[QRCODE] Saved QR image to: ${filepath}`)
        } catch (writeErr) {
          console.warn("[QRCODE] Failed to save QR image copy:", writeErr?.message || writeErr)
        }
      }
    } catch (saveErr) {
      console.warn("[QRCODE] Non-fatal: failed to write QR copy:", saveErr?.message || saveErr)
    }

    console.log(`[QRCODE] QR Code generated successfully`)
    return result
  } catch (err) {
    console.error("[QRCODE] Error generating QR Code:", err.message)
    throw new Error(`Gagal generate QR Code: ${err.message}`)
  }
}

/**
 * Convert Base64 Data URL to Buffer
 * @param {string} dataUrl - Base64 data URL from API
 * @returns {Buffer} - Image buffer
 */
export const base64ToBuffer = (dataUrl) => {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid data URL format")
  }

  const base64String = dataUrl.split(",")[1]
  if (!base64String) {
    throw new Error("Cannot extract base64 data from data URL")
  }

  return Buffer.from(base64String, "base64")
}