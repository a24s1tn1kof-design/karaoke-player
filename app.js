/* ============================================================
   app.js — ЧАСТЬ 1
   DOM-ссылки, состояние, IndexedDB, LRCLIB API, парсеры
   ============================================================ */

/* ---------- 1. ПОЛУЧЕНИЕ DOM-ЭЛЕМЕНТОВ ---------- */
const audio = document.getElementById("audio");
const playlistEl = document.getElementById("playlist");
const lyricsEl = document.getElementById("lyrics");
const songTitle = document.getElementById("songTitle");
const songSub = document.getElementById("songSub");
const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const volume = document.getElementById("volume");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const curTime = document.getElementById("curTime");
const durTime = document.getElementById("durTime");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const dropZone = document.getElementById("dropZone");
const modal = document.getElementById("modal");
const lyricsInput = document.getElementById("lyricsInput");
const editLyricsBtn = document.getElementById("editLyricsBtn");
const searchLyricsBtn = document.getElementById("searchLyricsBtn");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");

/* ---------- 2. СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---------- */
let songs = [];          // массив песен: { id, title, artist, blob, src, lyrics }
let currentIndex = -1;   // индекс играющей песни (-1 = ничего)
let lineElements = [];   // DOM-ссылки на строки текста (для быстрой подсветки)
let isSeeking = false;   // флаг: пользователь тянет прогресс-бар

/* ============================================================
   3. INDEXEDDB — хранилище песен (гигабайты)
   ============================================================ */

const DB_NAME = "KaraokePlayerDB";
const DB_VERSION = 1;
const STORE = "songs";
let db = null;

/** Открывает базу. Создаёт store, если его ещё нет */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = e => reject(e.target.error);
  });
}

/** Добавляет или перезаписывает песню */
function dbAdd(song) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(song);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

/** Удаляет песню по id */
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

/** Возвращает все песни */
function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

/** Обновляет только текст (не трогая blob) */
function dbUpdateLyrics(id, lyrics) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const song = req.result;
      if (song) {
        song.lyrics = lyrics;
        store.put(song);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

/* ============================================================
   4. LRCLIB API — бесплатный поиск текста с таймингами
   ============================================================ */

/**
 * Ищет текст: сначала точное совпадение, потом — свободный поиск.
 * @param {string} trackName — название
 * @param {string} artistName — артист (может быть пустым)
 * @param {number} duration — длительность в секундах
 * @returns {Promise<Array|null>} массив строк [{time, text, words}]
 */
async function fetchLyricsFromLRCLIB(trackName, artistName, duration) {
  // 4.1 — точный запрос
  const params = new URLSearchParams();
  params.set("track_name", trackName);
  if (artistName) params.set("artist_name", artistName);
  if (duration && isFinite(duration)) params.set("duration", Math.round(duration));

  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) return parseLRC(data.syncedLyrics);
      if (data.plainLyrics) return parsePlainLyrics(data.plainLyrics);
    }
  } catch (e) {
    console.warn("LRCLIB exact match failed:", e);
  }

  // 4.2 — свободный поиск
  const searchParams = new URLSearchParams();
  searchParams.set("q", `${trackName} ${artistName || ""}`.trim());

  try {
    const res = await fetch(`https://lrclib.net/api/search?${searchParams}`);
    if (res.ok) {
      const results = await res.json();

      // сначала ищем syncedLyrics
      for (const item of results) {
        if (item.syncedLyrics) return parseLRC(item.syncedLyrics);
      }
      // потом plainLyrics
      for (const item of results) {
        if (item.plainLyrics) return parsePlainLyrics(item.plainLyrics);
      }
    }
  } catch (e) {
    console.warn("LRCLIB search failed:", e);
  }

  return null;
}

/* ============================================================
   5. ПАРСЕРЫ
   ============================================================ */

/**
 * Парсит LRC-формат: [mm:ss.xx] текст
 * @param {string} lrcText
 * @returns {Array}
 */
function parseLRC(lrcText) {
  const lines = lrcText
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const result = [];

  lines.forEach(line => {
    // [mm:ss.xx], [mm:ss.xxx], [mm:ss]
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (m) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseFloat(m[2]);
      const text = m[3].trim();
      if (text) {
        result.push({
          time: minutes * 60 + seconds,
          text
        });
      }
    }
  });

  return addWordsToLines(result);
}

/**
 * Парсит обычный текст (без таймингов).
 * Распределяет строки равномерно по длительности трека.
 * @param {string} text
 * @returns {Array}
 */
function parsePlainLyrics(text) {
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const duration =
    audio.duration && isFinite(audio.duration)
      ? audio.duration
      : 180; // fallback: 3 минуты

  const step = duration / lines.length;

  const result = lines.map((text, i) => ({
    time: +(i * step).toFixed(2),
    text
  }));

  return addWordsToLines(result);
}

/**
 * Разбивает каждую строку на слова.
 * Время слов распределяется пропорционально длине слова.
 * @param {Array} lines
 * @returns {Array}
 */
function addWordsToLines(lines) {
  return lines.map((line, i) => {
    const words = line.text.split(/\s+/).filter(Boolean);

    // Одно слово — оно занимает всю строку
    if (words.length <= 1) {
      return { ...line, words: [{ t: line.time, w: line.text }] };
    }

    // Конец текущей строки = начало следующей (или +4 сек для последней)
    const nextTime = lines[i + 1] ? lines[i + 1].time : line.time + 4;
    const lineDuration = Math.max(0.5, nextTime - line.time);

    // Пропорционально длине слов
    const totalChars = words.reduce((s, w) => s + w.length, 0);
    let cursor = line.time;

    const wordsWithTime = words.map(w => {
      const wDur = (w.length / totalChars) * lineDuration;
      const start = cursor;
      cursor += wDur;
      return { t: +start.toFixed(2), w };
    });

    return { ...line, words: wordsWithTime };
  });
}

/* ============================================================
   6. РУЧНОЙ ПОИСК ТЕКСТА ПО КНОПКЕ 🔍
   ============================================================ */

searchLyricsBtn.addEventListener("click", async () => {
  if (currentIndex === -1) {
    alert("Сначала выбери песню");
    return;
  }

  const song = songs[currentIndex];

  // Блокируем кнопку
  searchLyricsBtn.disabled = true;
  searchLyricsBtn.textContent = "⏳ Поиск...";

  // Спиннер
  lyricsEl.innerHTML = `
    <div class="lyric-loading">
      <div class="spinner"></div>
      <span>Ищем текст для «${escapeHtml(song.title)}»...</span>
    </div>
  `;

  const lyrics = await fetchLyricsFromLRCLIB(
    song.title,
    song.artist || "",
    audio.duration
  );

  // Возвращаем кнопку
  searchLyricsBtn.disabled = false;
  searchLyricsBtn.textContent = "🔍 Найти текст";

  if (lyrics && lyrics.length > 0) {
    song.lyrics = lyrics;
    await dbUpdateLyrics(song.id, lyrics);
    renderLyrics(lyrics);
  } else {
    lyricsEl.innerHTML = `
      <p class="hint">
        😔 Текст не найден автоматически.<br>
        Нажми «✏ Редактировать», чтобы вставить вручную.
      </p>
    `;
  }
});

/* ============================================================
   7. УТИЛИТЫ
   ============================================================ */

/** Экранирует HTML (защита от XSS при выводе названий) */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Форматирует секунды в mm:ss */
function formatTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
  }
/* ============================================================
   app.js — ЧАСТЬ 2
   Загрузка файлов, плейлист, воспроизведение, караоке, клавиши
   ============================================================ */

/* ============================================================
   8. ЗАГРУЗКА ФАЙЛОВ (кнопка + drag&drop)
   ============================================================ */

uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", e => {
  handleFiles([...e.target.files]);
  fileInput.value = ""; // чтобы можно было загрузить тот же файл снова
});

// --- Drag & Drop ---
["dragenter", "dragover"].forEach(ev => {
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(ev => {
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
    // Игнорируем dragleave от дочерних элементов
    if (ev === "dragleave" && dropZone.contains(e.relatedTarget)) return;
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", e => {
  const files = [...e.dataTransfer.files].filter(f =>
    f.type.startsWith("audio/")
  );
  if (files.length) handleFiles(files);
});

/**
 * Обрабатывает выбранные файлы:
 * парсит имя, создаёт объект песни, сохраняет в IndexedDB.
 */
async function handleFiles(files) {
  const firstNewIndex = songs.length;

  for (const file of files) {
    const rawName = file.name.replace(/\.[^.]+$/, "");
    let artist = "";
    let title = rawName;

    // Парсим "Artist - Title.mp3"
    const dashMatch = rawName.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dashMatch) {
      artist = dashMatch[1].trim();
      title = dashMatch[2].trim();
    }

    const id =
      "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

    const song = {
      id,
      title,
      artist,
      blob: file,                     // сам файл — для IndexedDB
      src: URL.createObjectURL(file), // временный URL для <audio>
      lyrics: []
    };

    songs.push(song);
    await dbAdd(song);
  }

  renderPlaylist();

  // Если это первая загрузка — сразу запускаем первую песню
  if (firstNewIndex === 0) {
    playSong(0);
  }
}

/* ============================================================
   9. ПЛЕЙЛИСТ
   ============================================================ */

function renderPlaylist() {
  playlistEl.innerHTML = "";

  // Пусто
  if (songs.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "color:#6a6a6a;font-size:13px;padding:12px;text-align:center;";
    empty.textContent = "Пока пусто. Загрузи mp3 🎵";
    playlistEl.appendChild(empty);
    return;
  }

  songs.forEach((song, i) => {
    const item = document.createElement("div");
    item.className = "song-item" + (i === currentIndex ? " active" : "");

    // Обложка
    const cover = document.createElement("div");
    cover.className = "item-cover";
    cover.textContent = "♪";

    // Информация
    const info = document.createElement("div");
    info.className = "item-info";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = song.title;

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent =
      song.artist || (i === currentIndex ? "Играет..." : "Песня");

    info.append(title, sub);

    // Кнопка удаления
    const remove = document.createElement("button");
    remove.className = "item-remove";
    remove.textContent = "✕";
    remove.title = "Удалить";
    remove.addEventListener("click", async e => {
      e.stopPropagation();
      await removeSong(i);
    });

    item.append(cover, info, remove);
    item.addEventListener("click", () => playSong(i));
    playlistEl.appendChild(item);
  });
}

/** Удаляет песню: из БД, из массива, из UI */
async function removeSong(index) {
  if (!confirm(`Удалить "${songs[index].title}"?`)) return;

  const song = songs[index];
  const wasPlaying = index === currentIndex;

  // Освобождаем blob URL (иначе утечка памяти)
  if (song.src && song.src.startsWith("blob:")) {
    URL.revokeObjectURL(song.src);
  }

  await dbDelete(song.id);
  songs.splice(index, 1);

  if (songs.length === 0) {
    // Плейлист пуст
    currentIndex = -1;
    audio.pause();
    audio.src = "";
    songTitle.textContent = "Выбери песню";
    songSub.textContent = "или загрузи свою";
    lyricsEl.innerHTML = '<p class="hint">Выбери песню или загрузи mp3 🎤</p>';
    playBtn.textContent = "▶";
  } else if (wasPlaying) {
    // Играла удалённая — включаем следующую или предыдущую
    currentIndex = Math.min(index, songs.length - 1);
    playSong(currentIndex);
  } else if (index < currentIndex) {
    // Удалили то, что было до играющей — сдвигаем индекс
    currentIndex--;
  }

  renderPlaylist();
}

/* ============================================================
   10. ВОСПРОИЗВЕДЕНИЕ
   ============================================================ */

/** Включает песню по индексу */
function playSong(index) {
  if (index < 0 || index >= songs.length) return;

  currentIndex = index;
  const song = songs[index];

  audio.src = song.src;
  audio.play().catch(() => {});

  songTitle.textContent = song.title;
  songSub.textContent = song.artist || "Играет...";
  playBtn.textContent = "⏸";

  renderLyrics(song.lyrics || []);
  renderPlaylist();

  // Если текста нет — попробуем найти автоматически
  if (!song.lyrics || song.lyrics.length === 0) {
    autoFetchLyrics(song);
  }
}

/** Автопоиск текста (без нажатия кнопки) */
async function autoFetchLyrics(song) {
  lyricsEl.innerHTML = `
    <div class="lyric-loading">
      <div class="spinner"></div>
      <span>Ищем текст автоматически...</span>
    </div>
  `;

  const tryFetch = async () => {
    const lyrics = await fetchLyricsFromLRCLIB(
      song.title,
      song.artist || "",
      audio.duration
    );

    if (lyrics && lyrics.length > 0) {
      song.lyrics = lyrics;
      await dbUpdateLyrics(song.id, lyrics);

      // Проверяем, что песня всё ещё играет
      if (songs[currentIndex] && songs[currentIndex].id === song.id) {
        renderLyrics(lyrics);
      }
    } else {
      if (songs[currentIndex] && songs[currentIndex].id === song.id) {
        lyricsEl.innerHTML = `
          <p class="hint">
            😔 Текст не найден автоматически.<br>
            Нажми «🔍 Найти текст» или «✏ Редактировать».
          </p>
        `;
      }
    }
  };

  // Нужно знать duration — ждём метаданные
  if (isFinite(audio.duration) && audio.duration > 0) {
    tryFetch();
  } else {
    audio.addEventListener("loadedmetadata", tryFetch, { once: true });
  }
}

// --- Кнопки управления ---
playBtn.addEventListener("click", () => {
  if (currentIndex === -1) {
    if (songs.length) playSong(0);
    return;
  }
  if (audio.paused) {
    audio.play();
    playBtn.textContent = "⏸";
  } else {
    audio.pause();
    playBtn.textContent = "▶";
  }
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playSong(currentIndex - 1);
  else if (currentIndex === 0) audio.currentTime = 0;
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < songs.length - 1) playSong(currentIndex + 1);
});

audio.addEventListener("ended", () => {
  if (currentIndex < songs.length - 1) playSong(currentIndex + 1);
  else playBtn.textContent = "▶";
});

// --- Громкость ---
volume.addEventListener("input", () => {
  audio.volume = parseFloat(volume.value);
});
audio.volume = 1;

/* ============================================================
   11. ПРОГРЕСС-БАР
   ============================================================ */

audio.addEventListener("loadedmetadata", () => {
  durTime.textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  if (isSeeking) return;
  const d = audio.duration || 0;
  const c = audio.currentTime;
  progressBar.style.width = d ? (c / d * 100) + "%" : "0%";
  curTime.textContent = formatTime(c);
  updateLyricsHighlight(c);
});

progress.addEventListener("click", e => {
  const rect = progress.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  if (audio.duration) audio.currentTime = ratio * audio.duration;
});

/* ============================================================
   12. КАРАОКЕ
   ============================================================ */

/** Рисует строки текста в DOM */
function renderLyrics(lines) {
  lyricsEl.innerHTML = "";
  lineElements = [];

  if (!lines || lines.length === 0) {
    lyricsEl.innerHTML =
      '<p class="hint">Нет текста. Нажми «🔍 Найти текст» или «✏ Редактировать».</p>';
    return;
  }

  lines.forEach(line => {
    const p = document.createElement("p");
    p.className = "lyric-line";
    p.dataset.time = line.time;

    if (line.words && line.words.length) {
      // Пословное караоке
      line.words.forEach(w => {
        const span = document.createElement("span");
        span.className = "word";
        span.dataset.time = w.t;
        span.textContent = w.w + " ";
        p.appendChild(span);
      });
    } else {
      p.textContent = line.text;
    }

    lyricsEl.appendChild(p);
    lineElements.push(p);
  });
}

/** Обновляет подсветку в зависимости от текущего времени */
function updateLyricsHighlight(t) {
  const song = songs[currentIndex];
  if (!song || !song.lyrics || !song.lyrics.length) return;

  // Находим активную строку
  let activeIndex = -1;
  for (let i = 0; i < song.lyrics.length; i++) {
    if (t >= song.lyrics[i].time) activeIndex = i;
  }

  // Переключаем класс .active
  lineElements.forEach((el, i) => {
    el.classList.toggle("active", i === activeIndex);
  });

  // Автоскролл к активной строке
  if (activeIndex >= 0 && lineElements[activeIndex]) {
    const el = lineElements[activeIndex];
    const container = lyricsEl;
    const elTop = el.offsetTop - container.offsetTop;
    const target = elTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }

  // Пословная подсветка
  lineElements.forEach((p, i) => {
    const words = p.querySelectorAll(".word");
    if (!words.length) return;

    if (i !== activeIndex) {
      words.forEach(w => w.classList.remove("sung"));
      return;
    }
    words.forEach(w => {
      const wt = parseFloat(w.dataset.time);
      w.classList.toggle("sung", t >= wt);
    });
  });
}

/* ============================================================
   13. РЕДАКТОР ТЕКСТА
   ============================================================ */

editLyricsBtn.addEventListener("click", () => {
  if (currentIndex === -1) {
    alert("Сначала выбери песню");
    return;
  }
  const song = songs[currentIndex];
  lyricsInput.value = (song.lyrics || [])
    .map(l => `[${l.time}] ${l.text}`)
    .join("\n");
  modal.classList.add("show");
  lyricsInput.focus();
});

cancelBtn.addEventListener("click", () => modal.classList.remove("show"));

modal.addEventListener("click", e => {
  if (e.target === modal) modal.classList.remove("show");
});

saveBtn.addEventListener("click", async () => {
  if (currentIndex === -1) return;

  const song = songs[currentIndex];
  const raw = lyricsInput.value.trim();
  let lyrics = [];

  if (raw) {
    // Если пользователь вставил LRC-формат — парсим как LRC
    if (raw.match(/^\[\d+:\d+/m)) {
      lyrics = parseLRC(raw);
    } else {
      lyrics = parsePlainLyrics(raw);
    }
  }

  song.lyrics = lyrics;
  await dbUpdateLyrics(song.id, lyrics);
  renderLyrics(lyrics);
  modal.classList.remove("show");
});

/* ============================================================
   14. ГОРЯЧИЕ КЛАВИШИ
   ============================================================ */

document.addEventListener("keydown", e => {
  // Не перехватываем в полях ввода
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;

  if (e.code === "Space") {
    e.preventDefault();
    playBtn.click();
  } else if (e.code === "ArrowRight") {
    audio.currentTime = Math.min(
      audio.currentTime + 5,
      audio.duration || 0
    );
  } else if (e.code === "ArrowLeft") {
    audio.currentTime = Math.max(audio.currentTime - 5, 0);
  }
});

/* ============================================================
   15. ИНИЦИАЛИЗАЦИЯ
   ============================================================ */

async function init() {
  await openDB();
  const saved = await dbGetAll();

  // Восстанавливаем blob URL из сохранённых blob
  songs = saved.map(s => ({
    ...s,
    src: s.blob ? URL.createObjectURL(s.blob) : s.src
  }));

  renderPlaylist();
}

// Запускаем
init();
