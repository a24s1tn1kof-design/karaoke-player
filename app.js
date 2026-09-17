/* ============================================================
   🎵 KARAOKE PLAYER — ЧАСТЬ 1/2
   DOM, состояние, IndexedDB, ID3-теги, LRCLIB, парсеры,
   кнопка поиска текста, загрузка файлов
   ============================================================ */

/* ---------- 1. DOM-ЭЛЕМЕНТЫ ---------- */
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

/* ---------- 2. СОСТОЯНИЕ ---------- */
let songs = [];
let currentIndex = -1;
let lineElements = [];
let isSeeking = false;

/* ============================================================
   3. INDEXEDDB
   ============================================================ */

const DB_NAME = "KaraokePlayerDB";
const DB_VERSION = 1;
const STORE = "songs";
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function dbAdd(song) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(song);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbUpdateLyrics(id, lyrics) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const song = req.result;
      if (song) { song.lyrics = lyrics; store.put(song); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

/* ============================================================
   4. ID3-ТЕГИ
   ============================================================ */

function readID3Tags(file) {
  return new Promise(resolve => {
    if (typeof jsmediatags === "undefined") {
      console.warn("jsmediatags не загружен");
      return resolve(null);
    }

    jsmediatags.read(file, {
      onSuccess: tag => {
        const tags = tag.tags || {};
        resolve({
          title: (tags.title || "").trim(),
          artist: (tags.artist || "").trim(),
          album: (tags.album || "").trim()
        });
      },
      onError: err => {
        console.warn("Не удалось прочитать теги:", err);
        resolve(null);
      }
    });
  });
}

/* ============================================================
   5. LRCLIB API
   ============================================================ */

async function fetchLyricsFromLRCLIB(trackName, artistName, duration) {
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
  } catch (e) { console.warn("LRCLIB exact failed:", e); }

  const searchParams = new URLSearchParams();
  searchParams.set("q", `${trackName} ${artistName || ""}`.trim());

  try {
    const res = await fetch(`https://lrclib.net/api/search?${searchParams}`);
    if (res.ok) {
      const results = await res.json();
      for (const item of results) {
        if (item.syncedLyrics) return parseLRC(item.syncedLyrics);
      }
      for (const item of results) {
        if (item.plainLyrics) return parsePlainLyrics(item.plainLyrics);
      }
    }
  } catch (e) { console.warn("LRCLIB search failed:", e); }

  return null;
}

/* ============================================================
   6. ПАРСЕРЫ
   ============================================================ */

function parseLRC(lrcText) {
  const lines = lrcText.split("\n").map(l => l.trim()).filter(Boolean);
  const result = [];
  lines.forEach(line => {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (m) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseFloat(m[2]);
      const text = m[3].trim();
      if (text) result.push({ time: minutes * 60 + seconds, text });
    }
  });
  return addWordsToLines(result);
}

function parsePlainLyrics(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const duration = audio.duration && isFinite(audio.duration) ? audio.duration : 180;
  const step = duration / lines.length;
  const result = lines.map((text, i) => ({ time: +(i * step).toFixed(2), text }));
  return addWordsToLines(result);
}

function addWordsToLines(lines) {
  return lines.map((line, i) => {
    const words = line.text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      return { ...line, words: [{ t: line.time, w: line.text }] };
    }
    const nextTime = lines[i + 1] ? lines[i + 1].time : line.time + 4;
    const lineDuration = Math.max(0.5, nextTime - line.time);
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
   7. КНОПКА «🔍 НАЙТИ ТЕКСТ»
   ============================================================ */

searchLyricsBtn.addEventListener("click", async () => {
  if (currentIndex === -1) { alert("Сначала выбери песню"); return; }
  const song = songs[currentIndex];
  searchLyricsBtn.disabled = true;
  searchLyricsBtn.textContent = "⏳ Поиск...";

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
   8. ЗАГРУЗКА ФАЙЛОВ
   ============================================================ */

uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", e => {
  handleFiles([...e.target.files]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach(ev => {
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(ev => {
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
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

async function handleFiles(files) {
  const firstNewIndex = songs.length;

  for (const file of files) {
    const tags = await readID3Tags(file);

    let title = "";
    let artist = "";

    if (tags && tags.title) {
      title = tags.title;
      artist = tags.artist || "";
    } else {
      const rawName = file.name.replace(/\.[^.]+$/, "");
      title = rawName;
      const dashMatch = rawName.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        artist = dashMatch[1].trim();
        title = dashMatch[2].trim();
      }
    }

    const id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

    const song = {
      id,
      title,
      artist,
      blob: file,
      src: URL.createObjectURL(file),
      lyrics: []
    };

    songs.push(song);
    await dbAdd(song);
  }

  renderPlaylist();

  if (firstNewIndex === 0) {
    playSong(0);
  }
}

/* ============================================================
   ЧАСТЬ 1 ЗАКОНЧЕНА. Продолжение — во ЧАСТИ 2.
   ============================================================ */
/* ============================================================
   🎵 KARAOKE PLAYER — ЧАСТЬ 2/2
   Плейлист, воспроизведение, прогресс, караоке, редактор,
   клавиши, утилиты, запуск
   ============================================================ */

/* ============================================================
   9. ПЛЕЙЛИСТ
   ============================================================ */

function renderPlaylist() {
  playlistEl.innerHTML = "";

  if (songs.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:#6a6a6a;font-size:13px;padding:12px;text-align:center;";
    empty.textContent = "Пока пусто. Загрузи mp3 🎵";
    playlistEl.appendChild(empty);
    return;
  }

  songs.forEach((song, i) => {
    const item = document.createElement("div");
    item.className = "song-item" + (i === currentIndex ? " active" : "");

    const cover = document.createElement("div");
    cover.className = "item-cover";
    cover.textContent = "♪";

    const info = document.createElement("div");
    info.className = "item-info";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = song.title;

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = song.artist || (i === currentIndex ? "Играет..." : "Песня");

    info.append(title, sub);

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

async function removeSong(index) {
  if (!confirm(`Удалить "${songs[index].title}"?`)) return;

  const song = songs[index];
  const wasPlaying = index === currentIndex;

  if (song.src && song.src.startsWith("blob:")) {
    URL.revokeObjectURL(song.src);
  }

  await dbDelete(song.id);
  songs.splice(index, 1);

  if (songs.length === 0) {
    currentIndex = -1;
    audio.pause();
    audio.src = "";
    songTitle.textContent = "Выбери песню";
    songSub.textContent = "или загрузи свою";
    lyricsEl.innerHTML = '<p class="hint">Выбери песню или загрузи mp3 🎤</p>';
    playBtn.textContent = "▶";
  } else if (wasPlaying) {
    currentIndex = Math.min(index, songs.length - 1);
    playSong(currentIndex);
  } else if (index < currentIndex) {
    currentIndex--;
  }

  renderPlaylist();
}

/* ============================================================
   10. ВОСПРОИЗВЕДЕНИЕ
   ============================================================ */

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

  if (!song.lyrics || song.lyrics.length === 0) {
    autoFetchLyrics(song);
  }
}

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

  if (isFinite(audio.duration) && audio.duration > 0) {
    tryFetch();
  } else {
    audio.addEventListener("loadedmetadata", tryFetch, { once: true });
  }
}

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

function renderLyrics(lines) {
  lyricsEl.innerHTML = "";
  lineElements = [];

  if (!lines || lines.length === 0) {
    lyricsEl.innerHTML = '<p class="hint">Нет текста. Нажми «🔍 Найти текст» или «✏ Редактировать».</p>';
    return;
  }

  lines.forEach(line => {
    const p = document.createElement("p");
    p.className = "lyric-line";
    p.dataset.time = line.time;

    if (line.words && line.words.length) {
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

function updateLyricsHighlight(t) {
  const song = songs[currentIndex];
  if (!song || !song.lyrics || !song.lyrics.length) return;

  let activeIndex = -1;
  for (let i = 0; i < song.lyrics.length; i++) {
    if (t >= song.lyrics[i].time) activeIndex = i;
  }

  lineElements.forEach((el, i) => {
    el.classList.toggle("active", i === activeIndex);
  });

  if (activeIndex >= 0 && lineElements[activeIndex]) {
    const el = lineElements[activeIndex];
    const container = lyricsEl;
    const elTop = el.offsetTop - container.offsetTop;
    const target = elTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }

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
  if (currentIndex === -1) { alert("Сначала выбери песню"); return; }
  const song = songs[currentIndex];
  lyricsInput.value = (song.lyrics || []).map(l => `[${l.time}] ${l.text}`).join("\n");
  modal.classList.add("show");
  lyricsInput.focus();
});

cancelBtn.addEventListener("click", () => modal.classList.remove("show"));
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("show"); });

saveBtn.addEventListener("click", async () => {
  if (currentIndex === -1) return;
  const song = songs[currentIndex];
  const raw = lyricsInput.value.trim();

  let lyrics = [];
  if (raw) {
    if (raw.match(/^\[\d+:\d+/m)) lyrics = parseLRC(raw);
    else lyrics = parsePlainLyrics(raw);
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
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
  else if (e.code === "ArrowRight") audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 0);
  else if (e.code === "ArrowLeft") audio.currentTime = Math.max(audio.currentTime - 5, 0);
});

/* ============================================================
   15. УТИЛИТЫ
   ============================================================ */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* ============================================================
   16. СТАРТ
   ============================================================ */

async function init() {
  await openDB();
  const saved = await dbGetAll();
  songs = saved.map(s => ({
    ...s,
    src: s.blob ? URL.createObjectURL(s.blob) : s.src
  }));
  renderPlaylist();
}

init();
