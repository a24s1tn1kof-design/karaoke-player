/* ============================================================
   🎵 KARAOKE PLAYER — ЧАСТЬ 1/2
   DOM, состояние, IndexedDB, ID3, LRCLIB, парсеры,
   загрузка файлов с вводом названия
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

const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");

const uploadModal = document.getElementById("uploadModal");
const songNameInput = document.getElementById("songNameInput");
const saveNameBtn = document.getElementById("saveNameBtn");
const skipNameBtn = document.getElementById("skipNameBtn");
const uploadProgress = document.getElementById("uploadProgress");

/* ---------- 2. СОСТОЯНИЕ ---------- */
let songs = [];
let currentIndex = -1;
let lineElements = [];
let isSeeking = false;

let pendingFiles = [];
let pendingIndex = 0;

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
    if (typeof jsmediatags === "undefined") return resolve(null);
    jsmediatags.read(file, {
      onSuccess: tag => {
        const tags = tag.tags || {};
        resolve({
          title: (tags.title || "").trim(),
          artist: (tags.artist || "").trim()
        });
      },
      onError: () => resolve(null)
    });
  });
}

/* ============================================================
   5. LRCLIB API
   ============================================================ */

async function fetchLyricsFromLRCLIB(trackName, artistName) {
  const params = new URLSearchParams();
  params.set("track_name", trackName);
  if (artistName) params.set("artist_name", artistName);

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
   6. 📖 СЛОВАРЬ ЧАСТЫХ РУССКИХ СЛОВ
   ============================================================ */
const RU_DICT = new Set([
  "я","ты","он","она","оно","мы","вы","они","меня","тебя","его","её","нас","вас","их",
  "мне","тебе","ему","ей","нам","вам","им","мной","тобой","ним","ней","нами","вами","ими",
  "мой","моя","моё","мои","твой","твоя","твоё","твои","наш","наша","наше","наши",
  "ваш","ваша","ваше","ваши","свой","своя","своё","свои","себя","себе","собой",
  "этот","эта","это","эти","тот","та","то","те","такой","такая","такое","такие",
  "весь","вся","всё","все","сам","сама","само","сами","каждый","каждая","каждое","каждые",
  "кто","что","какой","какая","какое","какие","чей","чья","чьё","чьи",
  "который","которая","которое","которые","где","когда","куда","откуда","почему","зачем","как",
  "быть","есть","был","была","было","были","буду","будешь","будет","будем","будете","будут",
  "мочь","могу","можешь","может","можем","можете","могут","мог","могла","могло","могли",
  "хотеть","хочу","хочешь","хочет","хотим","хотите","хотят","хотел","хотела","хотело","хотели",
  "делать","делаю","делаешь","делает","делаем","делаете","делают","сделать","сделал","сделала",
  "говорить","говорю","говоришь","говорит","говорим","говорите","говорят","сказать","сказал","сказала",
  "знать","знаю","знаешь","знает","знаем","знаете","знают","знал","знала",
  "видеть","вижу","видишь","видит","видим","видите","видят","видел","видела",
  "слышать","слышу","слышишь","слышит","слышим","слышите","слышат","слышал","слышала",
  "думать","думаю","думаешь","думает","думаем","думаете","думают","думал","думала",
  "идти","иду","идёшь","идёт","идём","идёте","идут","шёл","шла","шло","шли","пойти","пошёл",
  "дать","даю","даёшь","даёт","даём","даёте","дают","дал","дала","дало","дали","давай","давайте",
  "взять","беру","берёшь","берёт","берём","берёте","берут","взял","взяла","взяли",
  "жить","живу","живёшь","живёт","живём","живёте","живут","жил","жила","жило","жили",
  "любить","люблю","любишь","любит","любим","любите","любят","любил","любила",
  "петь","пою","поёшь","поёт","поём","поёте","поют","пел","пела",
  "играть","играю","играешь","играет","играем","играете","играют",
  "стоять","стою","стоишь","стоит","стоим","стоите","стоят","стоял",
  "лежать","лежу","лежишь","лежит","лежим","лежите","лежат",
  "сидеть","сижу","сидишь","сидит","сидим","сидите","сидят","сидел",
  "летать","летаю","летаешь","летает","летаем","летаете","летают",
  "плакать","плачу","плачешь","плачет","плачем","плачете","плачут",
  "умереть","умру","умрёшь","умрёт","умрём","умрёте","умрут","умер","умерла",
  "время","года","год","годы","день","дни","дня","ночь","ночи","утро","утра","вечер","вечера",
  "жизнь","жизни","смерть","смерти","любовь","любви","сердце","сердца","душа","души",
  "глаз","глаза","рука","руки","руку","ноги","нога","голова","головы",
  "дом","дома","дому","город","города","страна","страны","земля","земли",
  "небо","неба","солнце","солнца","луна","луны","звезда","звезды","звёзды",
  "море","моря","река","реки","гора","горы","лес","леса","поле","поля","дорога","дороги","путь","пути",
  "друг","друга","друзья","друзей","враг","врага","враги","мать","матери","отец","отца",
  "сын","сына","дочь","дочери","брат","брата","сестра","сестры","жена","жены","муж","мужа",
  "ребёнок","ребёнка","дети","детей","человек","человека","люди","людей","людьми",
  "слово","слова","слов","песня","песни","песен","музыка","музыки","голос","голоса",
  "война","войны","мир","мира","битва","битвы","победа","победы",
  "счастье","счастья","радость","радости","печаль","печали","боль","боли","страх","страха",
  "мечта","мечты","надежда","надежды","вера","веры","судьба","судьбы","правда","правды","ложь","лжи",
  "работа","работы","деньги","денег","сила","силы","слабость","слабости",
  "хороший","хорошая","хорошее","хорошие","плохой","плохая","плохое","плохие",
  "большой","большая","большое","большие","маленький","маленькая","маленькое","маленькие",
  "новый","новая","новое","новые","старый","старая","старое","старые","молодой","молодая",
  "белый","белая","белое","белые","чёрный","чёрная","чёрное","чёрные","красный","красная",
  "синий","синяя","синее","синие","зелёный","зелёная","жёлтый","жёлтая",
  "первый","первая","первое","первые","последний","последняя","последнее","последние",
  "и","а","но","или","да","нет","не","ни","же","ли","бы","вот","вон","ещё","уж","уже",
  "в","во","на","за","под","над","из","от","до","по","при","про","без","для","через","между",
  "с","со","к","ко","о","об","обо","у","около","возле","после","перед",
  "там","тут","здесь","везде","нигде","всегда","никогда","иногда","часто","редко","снова","опять",
  "очень","слишком","совсем","почти","только","лишь","даже","именно","так",
  "хорошо","плохо","быстро","медленно","громко","тихо","легко","трудно","вместе","врозь",
  "потом","сначала","теперь","сейчас","затем","раньше","позже","скоро","давно",
  "давай","давайте","ну","ладно","пойдём","пошли","стой","подожди",
  "чтобы","если","хотя","потому","поэтому","зато","причём","притом",
  "ах","ох","ух","эх","ой","ай","эй",
  "привет","пока","здравствуй","здравствуйте","спасибо","пожалуйста","извини","прости",
  "один","одна","одно","одни","два","две","три","четыре","пять","шесть","семь","восемь","девять","десять",
  "сто","тысяча","миллион","много","мало","сколько","столько","несколько"
]);

/* ============================================================
   7. ПАРСЕРЫ
   ============================================================ */

/** Разбивает слитный текст на слова по словарю */
function splitSquishedText(text) {
  if (/\s/.test(text)) return text;

  const lower = text.toLowerCase();
  const result = [];
  let pos = 0;
  const maxWordLen = 20;

  while (pos < text.length) {
    let found = false;

    for (let len = Math.min(maxWordLen, text.length - pos); len >= 2; len--) {
      const candidate = lower.substr(pos, len);
      if (RU_DICT.has(candidate)) {
        result.push(text.substr(pos, len));
        pos += len;
        found = true;
        break;
      }
    }

    if (!found) {
      if (result.length > 0) {
        result[result.length - 1] += text[pos];
      } else {
        result.push(text[pos]);
      }
      pos++;
    }
  }

  return result.join(" ");
}

/** Парсит LRC-формат [mm:ss.xx] текст */
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

/** Парсит обычный текст — разбивает слова, потом на строки */
function parsePlainLyrics(text) {
  // 1. Если текст без пробелов и длинный — разрезаем на слова
  let prepared = "";
  const rawLines = text.split("\n").map(l => l.trim()).filter(Boolean);

  rawLines.forEach(line => {
    if (line.length > 15 && !/\s/.test(line)) {
      prepared += splitSquishedText(line) + "\n";
    } else {
      prepared += line + "\n";
    }
  });

  // 2. Разбиваем на строки по знакам препинания
  const sentences = [];
  const chunks = prepared.split(/\n+/).filter(Boolean);

  chunks.forEach(chunk => {
    const parts = chunk
      .split(/(?<=[.!?…])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    parts.forEach(part => {
      const words = part.split(/\s+/);
      if (words.length > 8) {
        const subParts = part.split(/(?<=,)\s+/);
        subParts.forEach(sp => {
          const spTrim = sp.trim();
          if (spTrim) sentences.push(spTrim);
        });
      } else {
        sentences.push(part);
      }
    });
  });

  const lines = sentences.length > 0 ? sentences : [text];

  // 3. Распределяем равномерно по длительности
  const duration = audio.duration && isFinite(audio.duration) ? audio.duration : 180;
  const step = duration / lines.length;

  const result = lines.map((text, i) => ({
    time: +(i * step).toFixed(2),
    text
  }));

  return addWordsToLines(result);
}

/** Разбивает строки на слова с временами */
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
   8. КНОПКА «НАЙТИ ТЕКСТ»
   ============================================================ */

searchLyricsBtn.addEventListener("click", async () => {
  if (currentIndex === -1) { alert("Сначала выбери песню"); return; }
  const song = songs[currentIndex];
  searchLyricsBtn.disabled = true;
  searchLyricsBtn.textContent = "Поиск...";

  lyricsEl.innerHTML = `
    <div class="lyric-loading">
      <div class="spinner"></div>
      <span>Ищем текст для «${escapeHtml(song.title)}»...</span>
    </div>
  `;

  const lyrics = await fetchLyricsFromLRCLIB(song.title, song.artist || "");

  searchLyricsBtn.disabled = false;
  searchLyricsBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <span>Найти текст</span>
  `;

  if (lyrics && lyrics.length > 0) {
    song.lyrics = lyrics;
    await dbUpdateLyrics(song.id, lyrics);
    renderLyrics(lyrics);
  } else {
    lyricsEl.innerHTML = `
      <p class="hint">
        Текст не найден автоматически.<br>
        Нажми «Редактировать», чтобы вставить вручную.
      </p>
    `;
  }
});

/* ============================================================
   9. ЗАГРУЗКА ФАЙЛОВ
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
  pendingFiles = files;
  pendingIndex = 0;
  await askNextFileName();
}

async function askNextFileName() {
  if (pendingIndex >= pendingFiles.length) {
    renderPlaylist();
    if (songs.length > 0 && currentIndex === -1) {
      playSong(0);
    }
    return;
  }

  const file = pendingFiles[pendingIndex];
  const defaultName = file.name.replace(/\.[^.]+$/, "");
  const tags = await readID3Tags(file);

  let placeholder = defaultName;
  if (tags && tags.title) {
    placeholder = tags.artist ? `${tags.artist} - ${tags.title}` : tags.title;
  }

  songNameInput.value = "";
  songNameInput.placeholder = placeholder;

  const remain = pendingFiles.length - pendingIndex;
  uploadProgress.innerHTML = remain > 1
    ? `Осталось песен: <b>${remain}</b>`
    : "";

  uploadModal.classList.add("show");
  setTimeout(() => songNameInput.focus(), 100);
}

saveNameBtn.addEventListener("click", async () => {
  const raw = songNameInput.value.trim();
  await finishFile(raw);
});

songNameInput.addEventListener("keydown", async e => {
  if (e.key === "Enter") {
    e.preventDefault();
    const raw = songNameInput.value.trim();
    await finishFile(raw);
  }
});

skipNameBtn.addEventListener("click", async () => {
  await finishFile("");
});

async function finishFile(rawName) {
  uploadModal.classList.remove("show");

  const file = pendingFiles[pendingIndex];
  if (!file) return;

  let title = "";
  let artist = "";

  if (rawName) {
    const dashMatch = rawName.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dashMatch) {
      artist = dashMatch[1].trim();
      title = dashMatch[2].trim();
    } else {
      title = rawName;
    }
  } else {
    const tags = await readID3Tags(file);
    if (tags && tags.title) {
      title = tags.title;
      artist = tags.artist || "";
    } else {
      const rawFileName = file.name.replace(/\.[^.]+$/, "");
      title = rawFileName;
      const dashMatch = rawFileName.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        artist = dashMatch[1].trim();
        title = dashMatch[2].trim();
      }
    }
  }

  const id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

  const song = {
    id, title, artist,
    blob: file,
    src: URL.createObjectURL(file),
    lyrics: []
  };

  songs.push(song);
  await dbAdd(song);

  if (title) {
    try {
      const lyrics = await fetchLyricsFromLRCLIB(title, artist);
      if (lyrics && lyrics.length > 0) {
        song.lyrics = lyrics;
        await dbUpdateLyrics(song.id, lyrics);
      }
    } catch (e) {
      console.warn("Не удалось найти текст:", e);
    }
  }

  renderPlaylist();

  pendingIndex++;
  await askNextFileName();
}

/* ============================================================
   ЧАСТЬ 1 ЗАКОНЧЕНА — продолжение во ЧАСТИ 2
   ============================================================ */
/* ============================================================
   🎵 KARAOKE PLAYER — ЧАСТЬ 2/2
   Плейлист, воспроизведение, прогресс, караоке,
   редактор, клавиши, утилиты, запуск
   ============================================================ */

/* ============================================================
   10. ПЛЕЙЛИСТ
   ============================================================ */

function renderPlaylist() {
  playlistEl.innerHTML = "";

  if (songs.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:#6a6a6a;font-size:13px;padding:12px;text-align:center;";
    empty.textContent = "Пока пусто. Загрузи mp3";
    playlistEl.appendChild(empty);
    return;
  }

  songs.forEach((song, i) => {
    const item = document.createElement("div");
    item.className = "song-item" + (i === currentIndex ? " active" : "");

    const cover = document.createElement("div");
    cover.className = "item-cover";
    cover.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    `;

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
    remove.title = "Удалить";
    remove.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
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
    lyricsEl.innerHTML = '<p class="hint">Выбери песню или загрузи mp3</p>';
    updatePlayIcon(false);
  } else if (wasPlaying) {
    currentIndex = Math.min(index, songs.length - 1);
    playSong(currentIndex);
  } else if (index < currentIndex) {
    currentIndex--;
  }

  renderPlaylist();
}

/* ============================================================
   11. ВОСПРОИЗВЕДЕНИЕ
   ============================================================ */

function playSong(index) {
  if (index < 0 || index >= songs.length) return;
  currentIndex = index;
  const song = songs[index];

  audio.src = song.src;
  audio.play().catch(() => {});

  songTitle.textContent = song.title;
  songSub.textContent = song.artist || "Играет...";

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

  const lyrics = await fetchLyricsFromLRCLIB(song.title, song.artist || "");

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
          Текст не найден автоматически.<br>
          Нажми «Найти текст» или «Редактировать».
        </p>
      `;
    }
  }
}

function updatePlayIcon(isPlaying) {
  if (isPlaying) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
  }
}

playBtn.addEventListener("click", () => {
  if (currentIndex === -1) {
    if (songs.length) playSong(0);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
});

audio.addEventListener("play", () => updatePlayIcon(true));
audio.addEventListener("pause", () => updatePlayIcon(false));
audio.addEventListener("ended", () => updatePlayIcon(false));

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playSong(currentIndex - 1);
  else if (currentIndex === 0) audio.currentTime = 0;
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < songs.length - 1) playSong(currentIndex + 1);
});

audio.addEventListener("ended", () => {
  if (currentIndex < songs.length - 1) playSong(currentIndex + 1);
});

volume.addEventListener("input", () => {
  audio.volume = parseFloat(volume.value);
});
audio.volume = 1;

/* ============================================================
   12. ПРОГРЕСС-БАР
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
   13. КАРАОКЕ
   ============================================================ */

function renderLyrics(lines) {
  lyricsEl.innerHTML = "";
  lineElements = [];

  if (!lines || lines.length === 0) {
    lyricsEl.innerHTML = '<p class="hint">Нет текста. Нажми «Найти текст» или «Редактировать».</p>';
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
   14. РЕДАКТОР ТЕКСТА
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
   15. ГОРЯЧИЕ КЛАВИШИ
   ============================================================ */

document.addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
  else if (e.code === "ArrowRight") audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 0);
  else if (e.code === "ArrowLeft") audio.currentTime = Math.max(audio.currentTime - 5, 0);
});

/* ============================================================
   16. УТИЛИТЫ
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
   17. СТАРТ
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
