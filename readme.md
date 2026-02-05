# ![License](https://img.shields.io/badge/license-MIT-green.svg) ![Python](https://img.shields.io/badge/Python-latest-blue.svg) ![Node.js](https://img.shields.io/badge/Node.js-18.x-brightgreen.svg) ![CLI](https://img.shields.io/badge/Interface-CLI-lightgrey.svg) ![Alpine](https://img.shields.io/badge/Distro-Alpine%20Linux-9cf.svg) ![WhatsApp Bot](https://img.shields.io/badge/Platform-WhatsApp%20Bot-25D366.svg)

# Bot Whatsapp Translator

Dokumentasi lengkap untuk repository: [HASYIM56/bot-translator](https://github.com/HASYIM56/bot-translator)

Ringkasan singkat: ini adalah bot WhatsApp berbasis Baileys (nodejs) yang menyediakan banyak utilitas — khususnya fitur terjemahan (.translate) — serta manajemen grup, pengunduhan media (YouTube / TikTok / MediaFire), manipulasi profile, auto-react, anti-delete, dan banyak lagi. Dirancang untuk berjalan di server Linux (Alpine kompatibel) dan memanfaatkan ffmpeg serta utilitas Python (yt-dlp) untuk beberapa fungsi.

---

## Daftar Isi
1. [Apa itu bot whatsapp?](#apa-itu-bot-whatsapp)  
2. [Instalasinya](#instalasinya)  
   - [Persyaratan sistem](#persyaratan-sistem)  
   - [Langkah instalasi (Git, Node.js, NPM, pip, ffmpeg)](#langkah-instalasi)  
   - [Instalasi dependensi npm & pip (detail)](#instalasi-dependensi)  
3. [Fitur Bot Whatsapp](#fitur-bot-whatsapp)  
   - Fitur utama: `.translate` (Penerjemah WA Translator)  
   - Daftar lengkap perintah / fitur  
4. [Struktur Project](#struktur-project)  
   - Penjelasan file / folder penting  
5. [Konfigurasi & File Persisten](#konfigurasi--file-persisten)  
6. [Penggunaan & Contoh Perintah](#penggunaan--contoh-perintah)  
7. [Catatan Keamanan & Etika](#catatan-keamanan--etika)  
8. [License](#license)

---

## Apa itu bot whatsapp?
Bot WhatsApp ini adalah aplikasi Node.js yang menggunakan pustaka Baileys untuk berinteraksi dengan Web/Cloud WhatsApp. Tujuannya:
- Menyediakan penerjemah pesan via perintah `.translate` (fitur utama).
- Menyediakan alat admin grup (kick, promote, demote, tagall, lock/unlock, dsb).
- Mengelola media: konversi stiker, voice-note, download YouTube/TikTok/MediaFire.
- Fitur pendukung: anti-delete (recover deleted messages), autoreact, self-react, auto-read, realtime bio/updater, auto-block pada panggilan masuk, dan masih banyak lagi.
Ringkas: bot multifungsi untuk otomatisasi dan utilitas chatting WhatsApp.

---

## Instalasinya

### Persyaratan sistem
- Node.js >= 18 (direkomendasikan Node 18 LTS)
- npm (disertakan dengan Node)
- Python (untuk skrip downloader: yt-dlp) — versi terbaru disarankan (3.10/3.11+)
- ffmpeg (system binary) — diperlukan untuk konversi audio/video
- Sistem berkas: akses untuk membuat folder `session/`, `config/`, dan folder permanen `/HASYIM56/*`

Docker/Alpine: jika menggunakan Alpine, instal paket sistem untuk ffmpeg dan Python sesuai distribusi.

### Langkah instalasi
1. Clone repo:
   ```bash
   git clone https://github.com/HASYIM56/bot-translator.git
   cd bot-translator
   ```
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Install Python dependency (yt-dlp):
   - Sistem dengan pip:
     ```bash
     pip install -U yt-dlp
     ```
   - Jika menggunakan virtualenv, aktifkan environment lalu install:
     ```bash
     python -m venv venv
     source venv/bin/activate
     pip install -U yt-dlp
     ```
4. Pastikan ffmpeg tersedia:
   - Debian/Ubuntu:
     ```bash
     sudo apt update && sudo apt install -y ffmpeg
     ```
   - Alpine:
     ```bash
     apk add --no-cache ffmpeg
     ```
   - Alternatif: repo sudah memiliki dependency `ffmpeg-static` tapi beberapa helper Python dan skrip CLI mengharapkan ffmpeg system-wide; sangat disarankan menginstall ffmpeg di OS.
5. Menjalankan bot:
   ```bash
   npm start
   ```
   Saat pertama kali, scan QR code di terminal (qrcode-terminal ditampilkan).

### Instalasi dependensi (detail)
- npm dependencies (dari package.json):
  - @whiskeysockets/baileys — WhatsApp Web protocol client
  - axios — HTTP client
  - ffmpeg-static — static binary helper (fallback)
  - pino — logger
  - qrcode-terminal — menampilkan QR di terminal
  - sharp — image processing (sticker, profile images)
  - node-fetch — fetch (dipakai di modul qrcode.js)
  - h56-translator — modul penerjemah (dipakai untuk .translate)
  - wa-sticker-formatter — opsi untuk membuat stiker profesional
  - mediafire — (opsional) helper library
- pip / python:
  - yt-dlp — untuk downloader TikTok / YouTube (dipakai di tiktok.py / youtube.py)
  - (opsional) ffmpeg system binary diperlukan untuk transcode; tidak di-install via pip

Catatan: beberapa script (tiktok.py / youtube.py) mengeluarkan progress JSON via stderr yang dipakai untuk menampilkan progress di chat. Pastikan `python` tersedia di PATH, atau edit script untuk path python spesifik.

---

## Fitur Bot Whatsapp

Fitur utama (ditandai):  
- .translate — Fitur utama: penerjemah pesan (support banyak bahasa). (Fitur utama dari WA Translator)

Daftar lengkap perintah / fitur (berdasarkan source code):
- .menu — Tampilkan menu (ini)
- .dev — Informasi developer & kontak
- .public / .private — Ubah mode akses bot (public / private)
- .kickall — Keluarkan semua member kecuali owners & bot (Owner Utama)
- .spam <n> <pesan> — Kirim pesan berulang (Owner Utama)
- .spamreport <nomor_target> <jumlah_report> — Jalankan mass report terhadap nomor (Only Owner Utama) — menyediakan cancel (.spamreport cancel)
- .autoreact on/off — Toggle AutoReact (Owner Utama)
- .antidelete on/off — Toggle anti-delete (Owner)
- .block / .unblock — Blokir / buka blokir nomor (Only Owner Utama)
- .kick — Keluarkan satu member (Owner)
- .admin — Promosikan member jadi admin (Owner)
- .unadmin — Copot hak admin (Owner)
- .setpp — Set profile picture bot (Owner Utama)
- .setpppanjang — Set profile picture panjang (Owner Utama) — tanpa canvas, menyesuaikan ukuran dan kompresi
- .setppgrup — Set photo grup (Owner / admin)
- .hidetag <pesan> — Kirim pesan dengan mention semua (Owner)
- .tagall <pesan> — Mention semua member (Owner Utama)
- .closegroup / .opengroup — Lock / Unlock group (admin)
- .deletemsg — Hapus pesan (Owner + bot harus admin) — perbaikan robust delete
- .stiker — Ubah gambar menjadi stiker (JPEG/PNG/WEBP), dukungan wa-sticker-formatter dan fallback sharp/ffmpeg
- .audiotovn — Konversi audio menjadi Voice Note (OGG/OPUS) (reply audio)
- .addmember <nomor> — Tambah member via nomor (Owner)
- .qrcode <url/teks> — Generate QR code (menggunakan API eksternal, simpan di /HASYIM56/qrcode)
- .viewonce — Recover media view-once (reply view-once message)
- .ttdownload <url> [resolusi] — Download TikTok (menggunakan tiktok.py / yt-dlp) — private chat only
- .ttsearch <username> — Cari pengguna TikTok (via module tiktok.js)
- .fwd on/off — Forward Many Times Mode (Owner Utama)
- .ytmp4 <url> <resolusi> — Download YouTube -> MP4 (private chat only; menggunakan youtube.py)
- .ytmp3 <url> <bitrate> — Download YouTube -> MP3 (private chat only; menggunakan youtube.py)
- .audiofake <duration> [reply / mention] — Buat audio palsu (fake-duration) dan kirim sebagai voice-note (Owner)
- .mediafire <link> — Download file dari MediaFire (diproteksi private chat)
- Realtime / background behaviors:
  - Auto-react otomatis pada pesan masuk (initial + done)
  - Self-react (bot bereaksi pada pesan yang dikirimnya secara dua tahap)
  - Auto-read (menandai pesan sebagai dibaca secara batch)
  - Recording indicator (tunjukkan presence recording saat mengirim pesan)
  - Realtime bio updater (update profile status / about dengan runtime)
  - Auto-block on incoming calls (otomatis reject & block nomor yang telepon bot; pengecualian owner)
  - Anti-delete: menyimpan salinan pesan masuk & re-send saat user menghapus pesan
  - Integrasi block manager: persist blocked list ke config/blocked-user.json
  

  - .githubsearch <username>

Deskripsi singkat
- Perintah: `.githubsearch <username>`
- Fungsi: Mengambil dan menampilkan ringkasan profil GitHub publik dari sebuah username menggunakan library scraping (`h56-github-scrapper`). Informasi yang dikembalikan meliputi nama, bio, lokasi (jika ada), jumlah repository publik, jumlah followers / following, URL profil, serta daftar 3–5 repository unggulan (diurutkan menurut bintang).

Contoh penggunaan
- .githubsearch torvalds
- .githubsearch octocat

Output (format ringkasan)
- 👤 Username : <username>
- 📝 Nama     : <display name atau "-">
- 💬 Bio      : <bio atau "-">
- 📍 Lokasi   : <lokasi jika tersedia>
- 📦 Repos publik : <jumlah repos publik>
- 👥 Followers   : <jumlah followers>   •   ➡ Following: <jumlah following>
- 🔗 Profil   : <url profil>
- 🏆 Top repositories:
  • <repo-name> (<language>) ⭐<stars> • Forks:<forks> — <description>
    <repo-url>

Perilaku & catatan penting
- Handler berupaya mengekstrak followers/following dari beberapa lokasi struktur hasil scraping (field `profile` atau `stats`). Jika angka followers/following tampil 0, penyebab umum:
  - Versi library `h56-github-scrapper` lebih baru/lebih lama yang mengubah struktur output — perbaikan handler membaca dari beberapa kemungkinan key telah ditambahkan.
  - Rate limit, koneksi, atau perubahan format GitHub dapat memengaruhi scraping.
- Bila avatar (foto profil) tersedia, bot akan mencoba mengunduh dan mengirimkannya sebelum mengirim ringkasan teks.
- Jika scraping gagal (user tidak ditemukan, jaringan, atau parsing error), bot mengirim pesan bantuan/penjelasan (contoh: "Username tidak ditemukan" atau "Masalah koneksi").
- Handler melakukan validasi username (maks 39 karakter, tidak diawali/diakhiri tanda `-`, huruf/angka/dash) untuk menghindari request yang jelas invalid.

Instalasi dependensi (minimal untuk fitur .githubsearch)
- Untuk menjalankan fitur .githubsearch saja, pastikan menginstal dependensi berikut di dalam proyek:
- 
  ```bash
  npm install h56-github-scrapper
  ```
  atau
  ```bash
  npm install axios h56-github-scrapper
  ```
- Rekomendasi: apabila menjalankan seluruh bot (seluruh file yang ada di repo), instal dependensi proyek secara penuh:
  ```bash
  npm install @whiskeysockets/baileys axios qrcode-terminal pino sharp ffmpeg-static wa-sticker-formatter h56-github-scrapper h56-translator
  ```
  Catatan:
  - `sharp` memerlukan toolchain native (libvips) — ikuti petunjuk instalasi sharp jika terjadi error pada instalasi.
  - `ffmpeg-static` menyediakan binari ffmpeg; pada beberapa sistem Anda mungkin perlu menginstal ffmpeg secara terpisah.
  - `wa-sticker-formatter` bersifat opsional; handler stiker memiliki fallback jika library tersebut tidak tersedia.

Konfigurasi / timeout
- Handler menggunakan timeout pendek saat mengunduh avatar (default 12s). Jika lingkungan server lambat, sesuaikan timeout pada pemanggilan axios di file `githubSearch.js`.
- Jika Anda sering melihat nilai followers/following tidak muncul atau selalu 0, update package `h56-github-scrapper` dan pastikan versi yang kompatibel digunakan. Jika perlu, laporkan issue ke repo package tersebut.

Troubleshooting singkat
- Followers/Following selalu muncul 0:
  - Pastikan `h56-github-scrapper` terinstal dan up-to-date.
  - Coba jalankan script scraping contoh (lihat dokumentasi package atau contoh CLI) untuk memastikan package mengembalikan `profile.followers` dan `profile.following`.
  - Jika paket mengubah shape output, handler dapat diupdate untuk membaca dari `result.profile.followers`, `result.profile.followers_count`, `result.stats.followers`, atau `result.stats.followers_count`. (Handler dalam repo sudah mencoba beberapa key umum.)
- Avatar tidak dikirim:
  - Periksa koneksi internet dan izin outbound dari server (port/akses).
  - Periksa error di log; kesalahan unduh avatar tidak menghentikan pengiriman ringkasan teks.
- Error parsing JSON dari `h56-github-scrapper`:
  - Perbarui package; tambahkan logging untuk isi `result` yang dikembalikan untuk diagnostic.

Contoh pesan bantuan yang muncul pada input invalid
- Jika username kosong:
  ```
  Format: .githubsearch <username>
  Contoh: .githubsearch torvalds
  ```
- Jika username tidak valid:
  ```
  Username GitHub tidak valid. Pastikan hanya menggunakan huruf, angka, dan tanda '-' (tidak diawal/akhir). Contoh: torvalds
  ```

Privasi & etika
- Fitur ini melakukan scraping terhadap profil publik GitHub. Pastikan penggunaan mematuhi ketentuan layanan GitHub.
- Hindari penggunaan berulang (mass scraping) yang dapat menyebabkan pemblokiran IP atau tindakan rate-limiting.

Integrasi & lokasi penambahan
- Tambahkan bagian dokumentasi ini ke README.md di bawah bagian "Commands" atau "Features".
- Jika README sudah memiliki daftar perintah, cari header atau bagian yang membahas perintah-perintah (mis. "Commands", "Daftar Perintah", atau "Fitur") dan sisipkan teks ini sebagai sub-bagian berjudul "GitHub Search (.githubsearch)".
- Jika tidak ada section yang sesuai, tambahkan di akhir file README.md sebagai bagian baru bernama:
  ```markdown
  ## Fitur: .githubsearch <username>
  ```
  (Gunakan langsung teks di atas — seluruh blok ini adalah konten yang harus ditambahkan.)

Versi ringkas untuk disisipkan (copy-paste)
- Jika Anda ingin hanya menempel blok ringkas ke README di bawah "Commands", gunakan bagian berikut (mulai dari "### GitHub Search (.githubsearch)" sampai "Contoh penggunaan"):
  ```markdown
  ### GitHub Search (.githubsearch)
  - Perintah: `.githubsearch <username>`
  - Mengambil ringkasan profil publik GitHub (nama, bio, lokasi, repos, followers, following, top repos).
  - Contoh: `.githubsearch torvalds`
  ```


Catatan: beberapa perintah hanya dapat dijalankan oleh Owner Utama (nomor yang ditentukan di index.js sebagai OWNER_NUMBER) atau akun terdaftar di config/owners.json.

---

## Struktur Project

Root:
- index.js
  - File utama yang menginisiasi socket Baileys, registrasi handler, pengaturan command, integrasi modul lain.
- block.js
  - Modul untuk persisten blocked-user list, patching updateBlockStatus / updateBlocklist, monkey-patch sendMessage suppression saat reply to blocked user di grup, dan blockManager API.
  - Menyimpan data ke: config/blocked-user.json
- mediafire.js
  - Handler `.mediafire` untuk mengunduh file MediaFire secara robust, progress, dan penyimpanan sementara di /HASYIM56/mediafire.
- qrcode.js
  - Utility generateQRCode() dan base64ToBuffer() — memanggil external API dan menyimpan salinan ke /HASYIM56/qrcode.
- realtime-bio.js
  - Helper modular untuk update realtime profile status (about). Mengembalikan handle interval dengan .stop().
- tiktok.py / youtube.py
  - Skrip Python untuk mengunduh media (yt-dlp) dengan progress structured pada stderr.
- package.json
  - Daftar dependency npm & metadata.
- config/ (folder)
  - owners.json — daftar owner tambahan (bisa array atau object { owners: [...] })
  - access-mode.json — menyimpan "public" / "private"
  - blocked-user.json — persistent blocklist (diproduksi oleh block.js)
  - autoreact.json — status autoreact
  - antidelete.json — status antidelete
- session/ (folder)
  - otentikasi multi-file yang digunakan Baileys (dibuat oleh useMultiFileAuthState)
- /HASYIM56 (permanent media folder) — (root path `/HASYIM56`, pastikan server mengizinkan)
  - youtube/ — file hasil unduhan youtube/ttdownload
  - qrcode/ — hasil QR code
  - mediafire/ — file hasil download mediafire
  - audio/ — file audio & voice-note temporer / sample
  - sticker/ — temporary / generated sticker files

Penjelasan singkat tiap path:
- index.js: orchestrator utama, attach event listeners, command dispatch, inisialisasi socket.
- block.js: menjaga blocked-user.json, menyediakan API sock.blockManager.* dan integrasi patch pada sock.updateBlockStatus/updateBlocklist.
- mediafire.js: scraping direct-link MediaFire, downloadToFile dengan progress, dan kirim file sebagai document.
- qrcode.js: memanggil API pembuatan QR dan mengembalikan data URL -> buffer.
- realtime-bio.js: modul terpisah agar index.js lebih rapi; mengatur interval update about.
- tiktok.py / youtube.py: skrip Python yang dipanggil oleh index.js untuk mengunduh media; dirancang agar mengeluarkan progress parseable.
- package.json: dependency & script start.
- config/: folder konfigurasi persistent; gunakan untuk pengaturan akses & fitur.

---

## Konfigurasi & File Persisten
- OWNER_NUMBER (di index.js) — ubah sesuai nomor owner utama Anda (format international, contoh: 6281234567890)
- owners.json — tambahkan owner tambahan atau gunakan default.
- access-mode.json — mode operasi bot: "public" atau "private"
- autoreact.json — enable/disable auto-react
- antidelete.json — enable/disable antidelete
- blocked-user.json — dikelola oleh block.js, berisi list JID yang diblokir persistently
- session/ — kredensial Baileys

## Session & Auth — Perbaikan Terbaru (Session Management & Safe Startup)

Tanggal perbaikan: 2026-02-02  
Perbaikan pada proses load auth / session (useMultiFileAuthState) yang ditambahkan untuk mencegah akumulasi sesi lama, race condition pada startup, dan potensi memory/delay ketika bot dinyalakan kembali setelah lama tidak aktif.

Ringkasan singkat
- Tujuan perbaikan: mengurangi gangguan startup, mencegah instance ganda menimpa satu session, menghindari pemuatan kredensial/usang yang menyebabkan timeout atau perilaku tak terduga, serta menyediakan mekanisme operasional untuk arsip/restore session.
- Pendekatan: mekanisme lock file, deteksi sesi stale (berdasarkan last-modified), archival otomatis ke folder session_archives, dan pembersihan/penyelesaian lock saat proses keluar (SIGINT/SIGTERM/beforeExit).

Apa yang berubah (teknis, singkat)
- .session-lock.json
  - Saat bot memulai, ia akan mencoba memperoleh lock file di folder session.
  - Lock menyimpan pid lokal, timestamp mulai, dan versi node untuk diagnosa.
  - Jika lock sedang dipegang oleh proses yang hidup → startup baru akan gagal cepat (fail-fast) dan memberikan pesan jelas ke operator.
  - Jika lock ditemukan stale (PID mati atau terlalu tua berdasarkan TTL), lock otomatis dibersihkan dan startup melanjutkan.
- Archival session lama
  - Jika isi folder session belum dimodifikasi lebih dari batas TTL default (7 hari), folder session akan diarsipkan ke folder session_archives/session_YYYY-MM-DD_HH-MM-SS_xxx.
  - Arsip dilakukan dengan rename (jika memungkinkan) atau copy+remove (fallback untuk cross-device filesystem).
  - Setelah arsip dibuat, folder session baru kosong dibuat sehingga proses auth baru (scan QR) dapat berjalan bersih.
- Flush dan release lock saat proses keluar
  - Pada SIGINT/SIGTERM/beforeExit bot akan mencoba flush credentials (saveCreds) dan melepaskan session lock.
  - Tujuannya mencegah orphan lock yang memblokir restart.

Nilai default (lokal di kode)
- SESSION_MAX_AGE_MS = 7 hari (sesi lama diarsipkan apabila folder session tidak berubah selama 7 hari)
- SESSION_LOCK_TTL_MS = 1 hari (lock lebih tua dianggap stale)
- Lokasi arsip: session_archives berada satu level di luar folder session (contoh: jika session = ./session, arsip = ./session_archives)
- Lock file: .session-lock.json di dalam folder session

Operasional / Cara kerja (lebih rinci)
1. Saat start:
   - Bot mencoba acquireSessionLock():
     - Jika lock tidak ada → buat lock berisi { pid, startedAt, nodeVersion }.
     - Jika lock ada: periksa apakah PID hidup. Jika hidup dan usianya < TTL → startup gagal (log & exit).
     - Jika pid mati atau lock terlalu tua → hapus lock dan coba akuisisi lagi.
2. Setelah lock diperoleh:
   - Cek last modification time pada file di folder session.
   - Jika tidak ada file (session baru) → lanjut normal.
   - Jika ada dan usianya > SESSION_MAX_AGE_MS → pindahkan keseluruhan folder ke session_archives dan buat folder session kosong baru.
3. Panggil useMultiFileAuthState(SESSION_FOLDER) seperti sebelumnya untuk melanjutkan authentication.
4. Saat proses menerima SIGINT/SIGTERM/beforeExit → bot memanggil saveCreds() (best-effort) lalu melepaskan lock file.

Manfaat praktis
- Startup cepat dan deterministik: tidak akan mencoba memuat kredensial session yang sudah rusak/usang yang menyebabkan timeouts.
- Mencegah multiple instances: lock file meminimalkan resiko dua proses mengakses session yang sama secara bersamaan.
- Audit & rollback: sesi lama tidak dihapus, melainkan diarsipkan sehingga operator masih bisa memulihkan bila perlu.
- Fail-fast ketika ada instance lain aktif: membantu operator mengetahui jika ada proses lain masih berjalan (lebih baik daripada menghadapi hangs/kesalahan tak jelas).

Instruksi Operasional (operator)
- Jika saat start muncul pesan lock (Unable to acquire session lock):
  - Pemeriksaan cepat:
    - cek apakah ada proses bot lain berjalan (ps aux | grep node atau systemd service).
    - jika tidak ada, periksa file .session-lock.json di folder session dan lihat pid/timestamp.
  - Manual recovery:
    - Hapus file .session-lock.json jika yakin tidak ada instance lain; atau
    - Jika sesi lama ingin dipaksa di-archive, jalankan:
      - mv session session_manual_archive_YYYYMMDD && mkdir session
- Melakukan restore session lama:
  - Jika Anda perlu mengembalikan arsip session (mis. untuk memulihkan auth lama), copy folder yang diarsipkan kembali ke lokasi session (pastikan tidak ada lock aktif).
- Mengubah TTL / policy:
  - Kode default mengatur 7 hari / 1 hari TTL. Jika ingin konfigurasi dinamis, disarankan menambahkan file konfigurasi baru (contoh: config/session.json) dan menyesuaikan kode loadAuthState untuk membaca nilai-nilai tersebut.

Troubleshooting umum terkait sesi
- "Startup gagal: lock held by pid XXX" — pastikan tidak ada proses lain, atau jika proses itu tidak valid, hapus .session-lock.json secara manual.
- "Scan QR lagi diperlukan setelah upgrade" — ini normal jika folder session di-arsipkan (mis. lama/usang). Lakukan scan QR pada terminal untuk mengautentikasi kembali.
- "Sesi diarsipkan otomatis" — periksa folder session_archives/ untuk menemukan salinan lama. File tidak dihapus agar operator bisa audit/restore.
- "Lock tidak hilang setelah crash" — proses crash mungkin meninggalkan lock. Hapus .session-lock.json secara manual jika yakin tidak ada instance berjalan.

Rekomendasi best-practices
- Jalankan bot dengan tooling process manager (systemd / pm2 / docker) sehingga exit signals ditangani dengan rapi dan restart tidak mewariskan lock/partial state.
- Tetapkan cron housekeeping untuk memonitor folder session_archives (rotasi/pembersihan arsip usia > X hari) agar disk tidak terisi.
- Simpan konfigurasi TTL di config/session.json jika Anda perlu behavior berbeda di lingkungan dev vs prod.

Catatan keamanan & privacy
- Arsip session mengandung file authentication Baileys (credentials). Pastikan arsip disimpan di lokasi yang aman dan akses dibatasi.
- Jangan unggah session_archives ke layanan publik tanpa sanitasi.
- Jika ingin aman benar, hapus arsip yang tidak diperlukan atau simpan backup terenkripsi.

Contoh pesan operator saat encountering lock (yang kini lebih informatif)
- "[SESSION] Lock held by pid 12345 (age 3600s). Another instance likely running. If no instance, remove ./session/.session-lock.json and restart."
- "[SESSION] Archived stale session to ./session_archives/session_2026-02-02T12-00-00-abc123 — scan QR to re-auth."

Catatan pengembang
- Perubahan implementasi dibuat non-intrusive: logika command/event tidak diubah. Hanya bagian loadAuthState / main yang ditingkatkan agar startup lebih aman dan dapat dioperasikan.
- Jika Anda ingin, saya dapat menambahkan:
  - command admin untuk `!session status`, `!session unlock`, dan `!session archive` (hanya Owner Utama).
  - pembacaan TTL/paths dari config/session.json.
  - unit test kecil untuk skenario lock/archival pada environment CI.

Dengan tambahan dokumentasi ini, operator dan tim dev akan memiliki panduan jelas tentang bagaimana session/auth dikelola dan langkah apa yang harus diambil ketika mendapati masalah startup terkait session.

---

## Penggunaan & Contoh Perintah
- Start bot:
  ```bash
  npm start
  ```
  Scan QR yang ditampilkan pada terminal.

- Contoh: Terjemah
  ```
  .translate en Halo dunia
  ```
  Bot akan menerjemahkan "Halo dunia" ke Bahasa Inggris. (Fitur utama: `.translate`)

- Contoh: Download YouTube (private chat)
  ```
  .ytmp4 https://www.youtube.com/watch?v=XXXX 720p
  ```

- Contoh: Convert audio to VN:
  - Reply audio message dengan caption:
    ```
    .audiotovn
    ```

- Contoh: Recover view-once
  - Reply pesan view-once dengan caption:
    ```
    .viewonce
    ```

- Contoh: Toggle auto-react (Owner Utama)
  ```
  .autoreact off
  .autoreact on
  ```

- Contoh: Block nomor (Owner Utama)
  - Reply pesan user with `.block` atau `.block 0812345...`

---

## Catatan Keamanan & Etika
- Beberapa fitur (mis. .spamreport, .spam, .spamreport) dapat disalahgunakan. Gunakan hanya untuk tujuan pengujian yang etis dan patuhi kebijakan platform.
- Jangan membagikan folder `session/` atau file kredensial.
- Pastikan bot dijalankan di lingkungan aman; file media besar dapat mengisi disk — siapkan rotasi & pembersihan.
- Hati-hati menggunakan fitur auto-block untuk panggilan masuk; owner harus dikecualikan.

---

## Troubleshooting umum
- Jika ffmpeg tidak ditemukan: pastikan ffmpeg terinstal system-wide atau PATH mengarah ke binary.
- Error saat yt-dlp: pastikan `yt-dlp` terinstal di Python environment yang dipanggil (`python` di PATH).
- Permission denied saat menyimpan ke /HASYIM56: jalankan bot dengan hak akses yang tepat atau ubah path ke folder yang dapat ditulis.
- Jika Baileys mengeluarkan error auth: hapus folder `session/` dan scan ulang QR.

---

## License
Project ini dilisensikan di bawah MIT License — lihat file LICENSE di repo.

---

Terima kasih telah menggunakan Bot Whatsapp Translator. Untuk kontribusi, issues, atau pull-request, silakan kunjungi: https://github.com/HASYIM56/bot-translator

Jika Anda butuh dokumentasi lebih mendalam (contoh konfigurasi owners.json, penjelasan environment variables, atau Dockerfile/Compose), saya bisa bantu membuatkan tambahan tersebut.

---

## Dokumentasi Teknis Tambahan — Detail Perintah .translate

Catatan: bagian ini menambah dokumentasi teknis khusus untuk perintah `.translate`. Semua fitur dan teks di dokumen utama tidak diubah.

### Ringkasan singkat
Perintah `.translate` menerjemahkan teks yang diberikan ke bahasa target. Handler menggunakan modul `h56-translator` (diekspos sebagai `translate`) bersama fallback internal pada daftar bahasa (`TRANSLATE_LANGUAGES`). Handler bersifat robust terhadap beberapa bentuk respons dari layanan penerjemah dan memberikan pesan kesalahan yang ramah pengguna jika terjadi masalah.

- Pemanggilan: `.translate <kode_target> <teks>`
- Contoh:
  - `.translate en Halo dunia`
  - `.translate list` — menampilkan daftar bahasa yang didukung

### Izin & Konteks
- Perintah tunduk pada mekanisme BOT_ACCESS_MODE yang diterapkan di handler utama (mode `private` akan membatasi pengguna yang dapat memanggil).
- Perintah tidak dibatasi hanya untuk owner; siapa pun dapat memanggil selama mode akses mengizinkan.

### Tabel Struktur Fungsi: Alur & Tanggung Jawab (.translate)
Berikut adalah tabel ringkasan fungsi dan langkah-langkah yang terjadi ketika perintah `.translate` dipanggil. Kolom menjelaskan lokasi/komponen, tujuan, input, output, dan catatan kesalahan/fallback.

| Langkah | Fungsi / Lokasi (file) | Tujuan | Input | Output | Catatan / Error handling |
|---|---:|---|---|---|---|
| 1 | messages.upsert handler (index.js) | Deteksi perintah dan ekstraksi argumen | pesan teks utuh (dari user) | `args`, `cmd`, `target`, `textToTranslate` | Mengabaikan bila BOT_ACCESS_MODE == "private" dan pengirim bukan main owner / fromMe |
| 2 | Validasi argumen (index.js) | Pastikan ada kode target dan teks | `args` array | validasi pass/fail | Jika `args.length < 3` -> kirim panduan penggunaan |
| 3 | .translate list branch (index.js) | Kirim daftar bahasa | cmd `.translate list` | daftar bahasa (dari h56SupportedLanguages atau TRANSLATE_LANGUAGES) | Jika modul `h56-translator` menyediakan list, gunakan; jika gagal, gunakan peta fallback |
| 4 | Notify user (index.js) | Informasikan proses penerjemahan sedang berlangsung | — | kirim pesan "⏳ Sedang menerjemahkan, mohon tunggu..." | Non-blocking, memberi umpan balik UX |
| 5 | Panggil layanan penerjemah (h56-translator) | Lakukan terjemahan sebenarnya | `textToTranslate`, `target` | `result` (bisa string atau object) | Bungkus panggilan dengan try/catch; bila error -> kirim pesan kesalahan yang ramah |
| 6 | Normalisasi hasil (index.js) | Ekstrak `translatedText`, `sourceLang`, `targetLang` dari `result` | `result` | `translatedText`, `sourceLang`, `targetLang` | Mendukung banyak bentuk respons: string, {translatedText}, {data:{translatedText}}, {translation}, dsb. |
| 7 | Service status check (index.js) | Tangani error service (jika ada) | `result.serviceStatus` atau `result.raw.serviceStatus` | Kirim pesan error yang sesuai | Jika `serviceStatus === "error"` -> saring error dan kirim pesan yang relevan ke user |
| 8 | Compose reply (index.js) | Buat pesan akhir dengan info sumber & target | `translatedText`, `sourceLang`, `targetLang` | teks balasan | Mencari nama bahasa menggunakan `h56SupportedLanguages` atau map `TRANSLATE_LANGUAGES` untuk tampilan lebih ramah |
| 9 | Kirim hasil (index.js) | Kirim hasil terjemahan ke chat | `from`, `translatedText`, metadata | `sock.sendMessage(from, { text })` | Meng-quote pesan asli jika tersedia |
| 10 | Fallback dan error reporting | Menangani kegagalan tak terduga | exceptions dari pemanggilan library | pesan error ramah ke user; log server | Menangkap network/library errors dan menginformasikan user untuk mencoba lagi nanti |

### Alur logika (penjelasan langkah demi langkah)
1. Pesan masuk diproses di event `messages.upsert` (type `notify`). Jika pesan sesuai pola `.translate ...`, handler mengekstrak target bahasa dan teks sumber.
2. Jika argumen tidak lengkap, bot membalas dengan panduan penggunaan: `.translate <kode_target> <teks>` dan contoh.
3. Jika sub-argumen `list` diminta, bot mencoba menggunakan `h56SupportedLanguages` dari modul `h56-translator`. Bila tidak tersedia, fallback ke konstanta `TRANSLATE_LANGUAGES`.
4. Bot mengirim pemberitahuan sementara "⏳ Sedang menerjemahkan, mohon tunggu..." untuk memberi respons cepat ke pengguna.
5. Bot memanggil fungsi `h56Translate(textToTranslate, target)`. Pemanggilan ini dibungkus dengan try/catch. Jika pemanggilan gagal (mis. network error), bot mengirim pesan error informatif.
6. Hasil dari `h56Translate` dapat berupa:
   - string: langsung dianggap teks terjemahan;
   - object dengan properti `translatedText`;
   - object kompleks dengan nested `data.translatedText` atau `translation`.
   Handler melakukan ekstraksi fleksibel untuk mendukung banyak bentuk respons.
7. Jika respons memiliki status layanan `serviceStatus === "error"`, handler membaca `result.error` dan mengirim pesan yang menyatakan kode dan pesan error layanan.
8. Jika berhasil, handler menyusun pesan final yang menampilkan bahasa sumber (jika tersedia) beserta nama bahasa (jika dapat ditemukan), bahasa target, dan teks terjemahan.
9. Hasil dikirim ke chat yang sama, biasanya dengan `{ quoted: msg }` sehingga pengguna melihat konteks.
10. Semua error ditangani secara ramah: log di server untuk debugging, sementara pengguna mendapatkan pesan singkat dan disarankan untuk mencoba lagi nanti.

### Skema data — contoh respons yang diharapkan
- Permintaan:
  ```
  .translate en Halo dunia
  ```
- Contoh respons sukses (teks):
  ```
  🌐 Translate Result
  From: auto — Indonesian
  To: en — English

  Hello world
  ```
- Contoh respons error layanan:
  ```
  ❌ Translate service error: (quota_exceeded) Batas harian terlampaui.
  ```
- Contoh respons kegagalan panggilan:
  ```
  ❌ Terjadi kesalahan saat menerjemahkan: network error / service unavailable
  ```

### Edge cases & fallback handling (ringkasan)
- Jika `h56SupportedLanguages` tersedia, itu dipakai untuk validasi; jika tidak, `TRANSLATE_LANGUAGES` lokal berfungsi sebagai fallback.
- Jika `h56Translate` mengembalikan struktur tak terduga, handler:
  - mencoba beberapa jalur ekstraksi (`translatedText`, `data.translatedText`, `translation`, result string),
  - bila tidak menemukan teks, menginformasikan user bahwa terjemahan gagal.
- Jika target bahasa tidak dikenal, bot akan menyarankan `.translate list`.
- Handler memperlakukan empty/whitespace teks sebagai input invalid dan mengembalikan panduan penggunaan.
- Semua panggilan jaringan dibungkus di try/catch supaya tidak crash; pesan error yang dikirim ke user ringkas dan sopan.

### Rekomendasi operasional
- Pastikan paket `h56-translator` terpasang dan dapat mengakses layanan eksternal jika diperlukan.
- Untuk pengalaman terbaik, gunakan `.translate list` pada saat pertama kali untuk melihat kode bahasa yang didukung.
- Dalam mode `private`, hanya Owner Utama (atau akun yang sesuai) yang dapat memanggil perintah jika BOT_ACCESS_MODE di-set ke `private`.