# Daftar Dependensi Proyek (WA Bot)

Dokumen ini hanya berisi daftar dependensi yang ada pada proyek (NPM dan Python). Gunakan ini sebagai panduan instalasi minimal sebelum menjalankan bot.

> Catatan: beberapa fitur juga membutuhkan binary sistem (contoh: `ffmpeg`) dan library native (contoh: `sharp` membutuhkan libvips). Binary sistem tidak tercantum sebagai paket NPM/PIP di bawah tetapi wajib diinstal via package manager OS.

---

## NPM (package.json)
Direkomendasikan: jalankan `npm install` di root repo untuk menginstal semua dependensi. Berikut daftar dependensi yang tercantum di package.json:

- @whiskeysockets/baileys: ^6.7.0
- axios: ^1.6.0
- ffmpeg-static: ^5.2.0
- pino: ^8.16.0
- qrcode-terminal: ^0.12.0
- sharp: ^0.32.6
- node-fetch: ^3.3.2
- h56-translator: ^1.0.6
- wa-sticker-formatter: ^3.0.0
- mediafire: ^1.0.0
- (tambahan dalam repo: `h56-github-scrapper` dipakai oleh handler `.githubsearch` — jika belum terpasang, pasang juga)

Contoh pemasangan manual (opsional):
```bash
npm install @whiskeysockets/baileys@^6.7.0 axios@^1.6.0 ffmpeg-static@^5.2.0 pino@^8.16.0 qrcode-terminal@^0.12.0 sharp@^0.32.6 node-fetch@^3.3.2 h56-translator@^1.0.6 wa-sticker-formatter@^3.0.0 mediafire@^1.0.0
# jika butuh scraper github:
npm install h56-github-scrapper
```

Perhatian khusus:
- sharp memerlukan libvips / toolchain native. Pada Debian/Ubuntu: `apt install -y build-essential libvips-dev` atau gunakan prebuilt binaries sesuai dokumentasi sharp.
- ffmpeg-static menyediakan binary ffmpeg bundling, tetapi beberapa helper Python/skrip eksternal mengharapkan ffmpeg system-wide (disarankan menginstall `ffmpeg` di OS).

---

## Python (requirements.txt)
File `requirements.txt` di repo menyatakan:
- yt-dlp>=2026.2.4

Instalasi (direkomendasikan di virtualenv):
```bash
python -m venv venv
source venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

Atau instal langsung:
```bash
pip install "yt-dlp>=2026.2.4"
```

Catatan:
- Skrip Python (`tiktok.py`, `youtube.py`) memakai `yt_dlp` (package `yt-dlp`).
- Pastikan `python` yang dipanggil oleh `index.js` (via spawn) menunjuk ke environment yang memiliki `yt-dlp` terinstal, atau sertakan path absolute ke interpreter Python Anda.

---

## Binary & Sistem (ringkasan — perlu diinstall via OS package manager)
Proyek membutuhkan beberapa binary/system libraries agar fitur berjalan:
- ffmpeg — wajib untuk konversi audio/video (ffmpeg harus tersedia di PATH)
- (opsional tetapi disarankan) build tools & libvips untuk sharp.

Contoh instalasi pada Debian/Ubuntu:
```bash
sudo apt update
sudo apt install -y ffmpeg python3 python3-venv build-essential libvips-dev
```

Contoh instalasi pada Alpine:
```bash
apk add --no-cache ffmpeg python3 py3-pip build-base vips-dev
```

---

## Cara cepat (summary)
1. Clone repo
2. Node.js (>=18) terpasang → jalankan:
   ```bash
   npm install
   ```
3. Buat virtualenv Python & pasang yt-dlp:
   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
4. Pastikan ffmpeg tersedia di PATH:
   - cek: `ffmpeg -version`
5. Jalankan bot:
   ```bash
   npm start
   ```
