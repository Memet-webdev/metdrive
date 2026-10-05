/* =========================================================
   METDRIVE — LOGIC
   ========================================================= */

// === PENGATURAN ===
const PIN_BENAR = "051108";
// PENTING: Ganti API key ini dengan milikmu sendiri, lalu batasi aksesnya
// hanya ke folder di bawah ini lewat Google Cloud Console → API & Services → Credentials.
// Jangan pernah memakai API key milik orang lain.
const API_KEY = "AIzaSyBhXWXDqxD525D4XiwFiwE2mB3qqx0RSAk";
const FOLDER_ID = "1n8S-HdlFWmPQ3uUXt1jyzxsdRK1rpb_b";
// ==================

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;   // 1 menit
const ANIMATION_MS = 3000;      // durasi animasi 3 detik
const PAGE_SIZE = 100;          // file per request (maks Drive API)
const MAX_PAGES = 10;           // batas 1000 file, cegah request tak terbatas

const LOCK_KEY = "metdrive_lockout";
const ATTEMPT_KEY = "metdrive_attempts";

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Pemetaan nilai dropdown sort → orderBy Google Drive v3.
// "name-asc"/"name-desc" sengaja memakai "folder/nameNaturalsort" supaya
// huruf besar/kecil tidak mengurutkan terpisah (a.pdf vs A.pdf).
const SORT_TO_DRIVE = {
    "newest": "createdTime desc",
    "oldest": "createdTime asc",
    "name-asc": "folder,nameNaturalsort",
    "name-desc": "folder,nameNaturalsort desc"
};

// === ELEMEN ===
const pinDisplay = document.getElementById("pin-display");
const pinError = document.getElementById("pin-error");
const pinScreen = document.getElementById("pin-screen");
const lockoutTimer = document.getElementById("lockout-timer");
const virtualKeyboard = document.getElementById("virtual-keyboard");
const keyOk = document.getElementById("key-ok");

const welcomeOverlay = document.getElementById("welcome-overlay");
const welcomePercent = document.getElementById("welcome-percent");
const progressBar = document.getElementById("progress-bar");
const progressTrack = document.getElementById("progress-track");

const navbar = document.getElementById("navbar");
const liveDatetime = document.getElementById("live-datetime");
const netStatus = document.getElementById("net-status");
const netLabel = document.getElementById("net-label");
const lockButton = document.getElementById("lock-button");

const contentScreen = document.getElementById("content-screen");
const fileList = document.getElementById("file-list");
const fileSearch = document.getElementById("file-search");
const searchClear = document.getElementById("search-clear");
const fileSort = document.getElementById("file-sort");
const fileCount = document.getElementById("file-count");
const listStatus = document.getElementById("list-status");

// === STATE ===
let currentInput = "";
let isBusy = false;          // true saat proses submit / animasi berjalan
let attempts = 0;
let lockUntil = 0;
let errorTimeout = null;
let lockInterval = null;
let animInterval = null;
let netInterval = null;
let clockInterval = null;

let allFiles = [];           // semua file yang dimuat dari Drive
let isTruncated = false;     // true bila folder melebihi batas MAX_PAGES

// =========================================================
// LOCKOUT (disimpan di localStorage agar tidak bisa di-bypass
// dengan refresh halaman)
// =========================================================
function loadLockState() {
    attempts = parseInt(localStorage.getItem(ATTEMPT_KEY) || "0", 10) || 0;
    lockUntil = parseInt(localStorage.getItem(LOCK_KEY) || "0", 10) || 0;
}

function saveLockState() {
    localStorage.setItem(ATTEMPT_KEY, String(attempts));
    localStorage.setItem(LOCK_KEY, String(lockUntil));
}

function isLocked() {
    return Date.now() < lockUntil;
}

// =========================================================
// KEYPAD
// =========================================================
function setKeyboardEnabled(enabled) {
    virtualKeyboard.querySelectorAll("button").forEach(btn => {
        btn.disabled = !enabled;
    });
    // Tombol OK dipakai sebagai cadangan saja
    keyOk.disabled = !enabled || currentInput.length < PIN_LENGTH;
}

function updateDisplay() {
    pinDisplay.value = currentInput;
    pinDisplay.classList.toggle("has-value", currentInput.length > 0);
    if (currentInput.length > 0 && currentInput.length < PIN_LENGTH) {
        setKeyboardEnabled(true);
    }
}

function pressKey(num) {
    if (isBusy || isLocked() || currentInput.length >= PIN_LENGTH) return;
    currentInput += num;
    updateDisplay();
    setKeyboardEnabled(!isLocked());

    // Submit otomatis saat 6 digit sudah lengkap
    if (currentInput.length === PIN_LENGTH) {
        checkPin();
    }
}

function pressClear() {
    if (isBusy || isLocked()) return;
    currentInput = "";
    hideError();
    updateDisplay();
    setKeyboardEnabled(!isLocked());
}

function checkPin() {
    if (isBusy || isLocked() || currentInput.length < PIN_LENGTH) return;

    if (currentInput === PIN_BENAR) {
        onSuccess();
    } else {
        onFail();
    }
}

// =========================================================
// PIN SALAH
// =========================================================
function onFail() {
    attempts++;
    saveLockState();

    currentInput = "";
    updateDisplay();
    showError(`PIN salah. Sisa percobaan: ${Math.max(0, MAX_ATTEMPTS - attempts)}`);

    pinDisplay.classList.remove("shake");
    void pinDisplay.offsetWidth;   // restart animasi
    pinDisplay.classList.add("shake");
    setTimeout(() => pinDisplay.classList.remove("shake"), 500);

    if (attempts >= MAX_ATTEMPTS) {
        startLockout();
    } else {
        setKeyboardEnabled(true);
    }
}

function showError(message) {
    clearTimeout(errorTimeout);
    pinError.textContent = message;
    pinError.classList.add("show");
    errorTimeout = setTimeout(hideError, 1600);
}

function hideError() {
    clearTimeout(errorTimeout);
    pinError.classList.remove("show");
}

// =========================================================
// KUNCI 1 MENIT
// =========================================================
function startLockout() {
    // Jangan perpanjang kuncian yang masih berjalan (mis. setelah refresh)
    if (!isLocked()) {
        lockUntil = Date.now() + LOCKOUT_MS;
        saveLockState();
    }

    hideError();
    clearInterval(lockInterval);

    const tick = () => {
        const remaining = lockUntil - Date.now();

        if (remaining <= 0) {
            clearInterval(lockInterval);
            attempts = 0;
            lockUntil = 0;
            saveLockState();
            lockoutTimer.classList.remove("show");
            setKeyboardEnabled(true);
            return;
        }

        const total = Math.ceil(remaining / 1000);
        const m = String(Math.floor(total / 60)).padStart(2, "0");
        const s = String(total % 60).padStart(2, "0");
        lockoutTimer.textContent = `Terlalu banyak percobaan. Kunci ${m}:${s}`;
        lockoutTimer.classList.add("show");
        setKeyboardEnabled(false);
    };

    tick();
    lockInterval = setInterval(tick, 250);
}

// =========================================================
// PIN BENAR → ANIMASI 3 DETIK → HALAMAN BERIKUTNYA
// =========================================================
function onSuccess() {
    isBusy = true;
    setKeyboardEnabled(false);

    pinScreen.style.opacity = "0";
    pinScreen.style.transition = "opacity .35s ease";
    setTimeout(() => { pinScreen.style.display = "none"; }, 350);

    runWelcomeAnimation();
}

function runWelcomeAnimation() {
    // Mulai ambil data file di parallel agar tidak menganggur
    loadDriveFiles();

    progressBar.style.width = "0%";
    welcomePercent.textContent = "0%";
    progressTrack.setAttribute("aria-valuenow", "0");
    welcomeOverlay.classList.add("show");
    welcomeOverlay.setAttribute("aria-hidden", "false");

    const startedAt = Date.now();

    animInterval = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const percent = Math.min(100, (elapsed / ANIMATION_MS) * 100);
        const shownPercent = Math.floor(percent);

        progressBar.style.width = percent + "%";
        welcomePercent.textContent = shownPercent + "%";
        progressTrack.setAttribute("aria-valuenow", String(shownPercent));

        if (elapsed >= ANIMATION_MS) {
            clearInterval(animInterval);
            progressBar.style.width = "100%";
            welcomePercent.textContent = "100%";
            progressTrack.setAttribute("aria-valuenow", "100");

            // Tunggu sebentar agar 100% terbaca, lalu buka halaman
            setTimeout(finishWelcome, 450);
        }
    }, 50);
}

function finishWelcome() {
    welcomeOverlay.classList.remove("show");
    welcomeOverlay.setAttribute("aria-hidden", "true");

    // Navbar muncul dengan efek slide down
    setTimeout(() => {
        navbar.classList.add("show");
        startClockOnce();
        startConnectionMonitor();
        contentScreen.style.display = "block";
        isBusy = false;

        // Kalau data belum siap setelah animasi selesai, beri tahu user
        // daripada membiarkan "Memuat data..." menggantung tanpa penjelasan.
        if (!allFiles.length) {
            listStatus.textContent = "Memuat data dari Drive, mohon tunggu sebentar...";
        }
    }, 300);
}

// =========================================================
// KEMBALI KE LAYAR PIN
// =========================================================
function lockApp() {
    clearInterval(animInterval);
    clearInterval(lockInterval);
    clearInterval(netInterval);
    clearInterval(clockInterval);

    isBusy = false;
    currentInput = "";
    allFiles = [];
    isTruncated = false;

    fileSearch.value = "";
    searchClear.hidden = true;
    fileList.setAttribute("aria-busy", "false");
    fileCount.textContent = "";
    listStatus.textContent = "";

    // Bersihkan cache agar data Drive tidak tetap tampil di DOM
    fileList.innerHTML = "";
    fileList.classList.remove("empty");

    progressBar.style.width = "0%";
    welcomePercent.textContent = "0%";
    welcomeOverlay.classList.remove("show");
    welcomeOverlay.setAttribute("aria-hidden", "true");

    navbar.classList.remove("show");
    contentScreen.style.display = "none";
    contentScreen.style.opacity = "0";

    pinScreen.style.display = "flex";
    pinScreen.style.opacity = "1";
    hideError();
    updateDisplay();
    setKeyboardEnabled(!isLocked());
    fileSearch.focus();
}

// =========================================================
// NAVBAR: TANGGAL & JAM REAL-TIME (WIB)
// =========================================================
// Ambil angka tanggal/jam dalam zona WIB, lalu format sendiri dengan
// nama hari & bulan Bahasa Indonesia agar konsisten antar browser.
function getJakartaParts(date) {
    const opts = {
        timeZone: "Asia/Jakarta",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    };

    const parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(date);
    const get = (type) => {
        const found = parts.find(p => p.type === type);
        return found ? found.value : "";
    };

    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const monthIndex = parseInt(get("month"), 10) - 1;

    return {
        weekday: dayMap[get("weekday")],
        day: parseInt(get("day"), 10),
        month: monthIndex,
        year: get("year"),
        // Beberapa browser menulis "24" untuk tengah malam
        hour: get("hour").replace(/\D/g, "") % 24,
        minute: get("minute").replace(/\D/g, ""),
        second: get("second").replace(/\D/g, "")
    };
}

function formatJakartaTime(date) {
    const p = getJakartaParts(date);

    return `${DAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]} ${p.year} · ` +
        `${String(p.hour).padStart(2, "0")}:${p.minute}:${p.second} WIB`;
}

function startClock() {
    const tick = () => {
        liveDatetime.textContent = formatJakartaTime(new Date());
    };
    tick();
    setInterval(tick, 1000);
}

// Format tanggal file: "5 Oktober 2026, 14:32" (WIB)
function formatTanggal(isoString) {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";

    const p = getJakartaParts(date);

    return `${p.day} ${MONTHS[p.month]} ${p.year}, ` +
        `${String(p.hour).padStart(2, "0")}:${p.minute}`;
}

// =========================================================
// STATUS KONEKSI NAVBAR
// =========================================================
const NET_TIMEOUT_MS = 5000;
const NET_INTERVAL_MS = 10000;

function setNetStatus(state) {
    netStatus.classList.remove("checking", "online", "offline");
    netStatus.classList.add(state);
    netLabel.textContent = state === "online" ? "Online" : "Offline";
}

function driveFilesUrl(pageToken) {
    const order = SORT_TO_DRIVE[fileSort.value] || SORT_TO_DRIVE.newest;

    let url = `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents` +
        `&key=${API_KEY}` +
        `&fields=files(id,name,webViewLink,createdTime,mimeType,size)` +
        `&orderBy=${encodeURIComponent(order)}` +
        `&pageSize=${PAGE_SIZE}`;

    if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    return url;
}

// Mengecek apakah browser bisa menjangkau server Google Drive API.
// Bukan ping: yang diukur adalah keterjangkauan endpoint HTTP.
async function checkConnection() {
    // Browser sudah tahu sedang offline, tidak perlu menunggu request gagal
    if (navigator.onLine === false) {
        setNetStatus("offline");
        return;
    }

    const controller = new AbortController();
    // Tanpa timeout, request bisa menggantung dan status baru berubah 1 menit kemudian
    const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS);

    try {
        await fetch(driveFilesUrl(), {
            signal: controller.signal,
            cache: "no-store"
        });
        setNetStatus("online");
    } catch (error) {
        setNetStatus("offline");
    } finally {
        clearTimeout(timer);
    }
}

function startClockOnce() {
    if (clockInterval) return;   // hindari interval ganda saat lock/unlock
    startClock();
}

function startConnectionMonitor() {
    clearInterval(netInterval);
    checkConnection();
    netInterval = setInterval(checkConnection, NET_INTERVAL_MS);

    // Reaksi seketika saat koneksi berubah, tanpa menunggu tick berikutnya
    window.addEventListener("offline", () => setNetStatus("offline"));
    window.addEventListener("online", () => checkConnection());
}

// =========================================================
// MEMUAT DAFTAR FILE DARI GOOGLE DRIVE
// =========================================================
// Drive API maksimal 100 file per request. Karena tidak ada paginasi
// di UI, semua halaman diambil otomatis sampai habis (dibatasi MAX_PAGES)
// supaya file ke-101 dan seterusnya tidak hilang tanpa jejak.
async function loadDriveFiles() {
    fileList.setAttribute("aria-busy", "true");
    fileList.innerHTML = `<p class="loading">Memuat data...</p>`;

    const collected = [];
    let pageToken = null;
    isTruncated = false;

    try {
        for (let page = 0; page < MAX_PAGES; page++) {
            const response = await fetch(driveFilesUrl(pageToken));
            const data = await response.json();

            if (data.error) {
                fileList.setAttribute("aria-busy", "false");
                fileList.innerHTML = `<p class="notice accent">Error: Pastikan API KEY valid dan folder di-set Public.</p>`;
                return;
            }

            const files = data.files || [];
            collected.push(...files);

            pageToken = data.nextPageToken || null;

            // Semua file sudah terkumpul
            if (!pageToken) break;

            // Folder melebihi batas: berhenti, tandai agar user diberi tahu
            if (page === MAX_PAGES - 1) {
                isTruncated = true;
            }
        }

        allFiles = collected;
        renderFiles();
    } catch (error) {
        fileList.setAttribute("aria-busy", "false");
        fileList.innerHTML = `<p class="notice accent">Gagal menghubungi server. Periksa koneksi internet Anda.</p>`;
    }
}

// Ikon + ukuran berkas berdasarkan mimeType
const MIME_ICONS = [
    [/^application\/pdf/, "📕"],
    [/^image\//, "🖼️"],
    [/^video\//, "🎬"],
    [/^audio\//, "🎵"],
    [/spreadsheet|excel|^text\/csv/, "📊"],
    [/word|document/, "📘"],
    [/^text\//, "📝"],
    [/zip|compressed|rar|7z/, "🗜️"],
    [/^application\//, "📦"],
];

function fileIcon(mimeType) {
    if (!mimeType) return "📄";
    if (mimeType === "application/vnd.google-apps.folder") return "📁";
    const match = MIME_ICONS.find(([re]) => re.test(mimeType));
    return match ? match[1] : "📄";
}

function formatSize(bytes) {
    const n = Number(bytes);
    if (!n || isNaN(n) || n < 0) return "";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let value = n;

    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }

    return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// Menggambar daftar file, difilter kata kunci.
// Sorting ditangani oleh orderBy di sisi Drive.
function renderFiles() {
    const keyword = fileSearch.value.trim().toLowerCase();

    const list = keyword
        ? allFiles.filter(f => f.name.toLowerCase().includes(keyword))
        : allFiles;

    fileList.setAttribute("aria-busy", "false");

    // Bersihkan dulu, supaya pesan dari render sebelumnya tidak ikut nempel
    listStatus.textContent = "";

    // Jumlah file
    if (allFiles.length > 0) {
        fileCount.textContent = keyword
            ? `${list.length} dari ${allFiles.length} file cocok`
            : `${allFiles.length} file`;
    } else {
        fileCount.textContent = "";
    }

    // Beri tahu kalau folder melebihi batas pemuatan
    if (isTruncated) {
        listStatus.textContent =
            `Folder berisi lebih dari ${MAX_PAGES * PAGE_SIZE} file. ` +
            `Yang ditampilkan hanya ${allFiles.length} file pertama.`;
    }

    if (list.length === 0) {
        const reason = keyword
            ? `Tidak ada file yang cocok dengan "${fileSearch.value.trim()}"`
            : "Folder kosong atau tidak ditemukan.";
        fileList.innerHTML = `<p class="notice">${reason}</p>`;
        return;
    }

    fileList.innerHTML = "";

    list.forEach(file => {
        const fileEl = document.createElement("a");
        fileEl.className = "file-item";
        fileEl.href = file.webViewLink;
        fileEl.target = "_blank";
        fileEl.rel = "noopener noreferrer";
        fileEl.title = file.name;

        const iconEl = document.createElement("span");
        iconEl.className = "file-type";
        iconEl.setAttribute("aria-hidden", "true");
        iconEl.textContent = fileIcon(file.mimeType);

        // Nama file + tanggal + ukuran, ditumpuk dalam satu kolom
        const infoEl = document.createElement("span");
        infoEl.className = "file-info";

        const nameEl = document.createElement("span");
        nameEl.className = "file-name";
        nameEl.textContent = file.name;
        // Nama dipotong 1 baris di CSS, jadi simpan penuh untuk tooltip
        nameEl.title = file.name;

        const metaEl = document.createElement("span");
        metaEl.className = "file-meta";

        if (file.createdTime) {
            const dateEl = document.createElement("span");
            dateEl.className = "file-date";
            dateEl.textContent = `Diupload ${formatTanggal(file.createdTime)}`;
            metaEl.appendChild(dateEl);
        }

        const size = formatSize(file.size);
        if (size) {
            const sizeEl = document.createElement("span");
            sizeEl.className = "file-size";
            sizeEl.textContent = size;
            metaEl.appendChild(sizeEl);
        }

        infoEl.appendChild(nameEl);
        infoEl.appendChild(metaEl);

        const openEl = document.createElement("span");
        openEl.className = "open-link";
        openEl.textContent = "Buka ↗";

        fileEl.appendChild(iconEl);
        fileEl.appendChild(infoEl);
        fileEl.appendChild(openEl);
        fileList.appendChild(fileEl);
    });
}

// =========================================================
// EVENT
// =========================================================
virtualKeyboard.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;

    if (btn.dataset.key) {
        pressKey(btn.dataset.key);
    } else if (btn.dataset.action === "clear") {
        pressClear();
    } else if (btn.dataset.action === "ok") {
        checkPin();
    }
});

// Pencarian: filter di sisi klien, tanpa request ulang ke Drive
function syncSearchUI() {
    searchClear.hidden = fileSearch.value.length === 0;
}

fileSearch.addEventListener("input", () => {
    syncSearchUI();
    if (allFiles.length > 0) renderFiles();
});

// Tombol hapus pencarian
searchClear.addEventListener("click", () => {
    fileSearch.value = "";
    syncSearchUI();
    if (allFiles.length > 0) renderFiles();
    fileSearch.focus();
});

// Ganti urutan: orderBy ikut berubah, jadi muat ulang dari Drive
fileSort.addEventListener("change", () => {
    if (contentScreen.style.display === "block") {
        loadDriveFiles();
    }
});

// Kunci kembali ke layar PIN
lockButton.addEventListener("click", () => {
    if (!isBusy) lockApp();
});

// Keyboard PC
window.addEventListener("keydown", function (e) {
    const onPinScreen = pinScreen.style.display !== "none";

    // Shortcut di halaman file: fokus search dengan "/", buka kunci dengan "l"
    if (!onPinScreen) {
        const typing = e.target.matches("input, select, textarea");

        if (e.key === "/" && !typing) {
            e.preventDefault();
            fileSearch.focus();
            fileSearch.select();
            return;
        }

        if ((e.key === "l" || e.key === "L") && !typing && !isBusy) {
            lockApp();
            return;
        }

        if (e.key === "Escape" && document.activeElement === fileSearch) {
            fileSearch.value = "";
            syncSearchUI();
            if (allFiles.length > 0) renderFiles();
            fileSearch.blur();
        }
        return;
    }

    if (e.key >= "0" && e.key <= "9") {
        pressKey(e.key);
    } else if (e.key === "Backspace" || e.key === "Delete") {
        if (!isBusy && !isLocked()) {
            currentInput = currentInput.slice(0, -1);
            updateDisplay();
            setKeyboardEnabled(true);
        }
    } else if (e.key === "Enter") {
        checkPin();
    }
});

// =========================================================
// INIT
// =========================================================
(function init() {
    loadLockState();
    updateDisplay();

    if (isLocked()) {
        attempts = MAX_ATTEMPTS;
        startLockout();
    } else {
        setKeyboardEnabled(true);
    }
})();