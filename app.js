<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Karaoke Player</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<div class="app">

  <!-- SIDEBAR -->
  <aside class="sidebar">
    <div class="logo">
      <span class="logo-icon">🎵</span>
      <span class="logo-text">Karaoke</span>
    </div>

    <button class="upload-btn" id="uploadBtn">
      ⬆ Загрузить песню
    </button>
    <input type="file" id="fileInput" accept="audio/*" multiple hidden>

    <div class="playlist" id="playlist"></div>

    <div class="drop-hint" id="dropHint">
      Перетащи сюда mp3
    </div>
  </aside>

  <!-- MAIN -->
  <main class="main" id="dropZone">
    <div class="now-playing" id="nowPlaying">
      <div class="cover" id="cover">🎧</div>
      <div class="song-info">
        <div class="song-title" id="songTitle">Выбери песню</div>
        <div class="song-sub" id="songSub">или загрузи свою</div>
      </div>
    </div>

    <!-- ПРОГРЕСС -->
    <div class="progress-wrap">
      <span class="time" id="curTime">0:00</span>
      <div class="progress" id="progress">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <span class="time" id="durTime">0:00</span>
    </div>

    <!-- УПРАВЛЕНИЕ -->
    <div class="controls">
      <button class="ctrl" id="prevBtn" title="Назад">⏮</button>
      <button class="ctrl play" id="playBtn" title="Играть">▶</button>
      <button class="ctrl" id="nextBtn" title="Вперёд">⏭</button>

      <div class="volume-wrap">
        <span class="vol-icon">🔊</span>
        <input type="range" id="volume" min="0" max="1" step="0.01" value="1">
      </div>
    </div>

    <!-- ТЕКСТ -->
    <div class="lyrics-header">
      <h2>Текст песни</h2>
      <div class="lyrics-actions">
        <button class="search-btn" id="searchLyricsBtn">🔍 Найти текст</button>
        <button class="edit-btn" id="editLyricsBtn">✏ Редактировать</button>
      </div>
    </div>

    <div class="lyrics" id="lyrics">
      <p class="hint">Выбери песню или загрузи mp3 🎤</p>
    </div>

    <audio id="audio"></audio>
  </main>

</div>

<!-- 🆕 МОДАЛКА ВВОДА НАЗВАНИЯ ПРИ ЗАГРУЗКЕ -->
<div class="modal" id="uploadModal">
  <div class="modal-box">
    <h3>🎵 Что за песня?</h3>
    <p class="modal-hint">
      Введи <b>артиста и название</b> — по ним найдём текст.<br>
      Формат: <code>Исполнитель - Название</code><br>
      Например: <code>Imagine Dragons - Thunder</code>
    </p>

    <input
      type="text"
      id="songNameInput"
      class="song-name-input"
      placeholder="Imagine Dragons - Thunder"
      autocomplete="off"
    >

    <div class="modal-buttons">
      <button class="btn cancel" id="skipNameBtn">Пропустить</button>
      <button class="btn save" id="saveNameBtn">Сохранить и искать</button>
    </div>
  </div>
</div>

<!-- МОДАЛКА РЕДАКТОРА ТЕКСТА -->
<div class="modal" id="modal">
  <div class="modal-box">
    <h3>Текст песни</h3>
    <p class="modal-hint">
      Одна строка = одна строка караоке.<br>
      Можно указать время: <code>[12.5] Привет</code><br>
      Если время не указать — распределится автоматически.
    </p>
    <textarea id="lyricsInput" placeholder="[0] Привет
[2] Как дела?
[4.5] Я скучал по тебе"></textarea>
    <div class="modal-buttons">
      <button class="btn cancel" id="cancelBtn">Отмена</button>
      <button class="btn save" id="saveBtn">Сохранить</button>
    </div>
  </div>
</div>

<!-- 📚 Библиотека ID3 (на случай если ввод пропустят) -->
<script src="https://cdn.jsdelivr.net/npm/jsmediatags@3.9.7/dist/jsmediatags.min.js"></script>

<!-- 🎵 Основной скрипт -->
<script src="app.js"></script>

</body>
</html>
