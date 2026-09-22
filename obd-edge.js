/**
 * obd-edge.js — парсер карточек OBD Memorial (obd-memorial.ru)
 *
 * ОТЛИЧИЕ от старой версии (archive/index.js):
 *  - НЕ запускает браузер сам (безголовый Chrome убран в архив).
 *  - ПОДКЛЮЧАЕТСЯ по CDP к уже запущенному Edge (remote-debugging-port).
 *  - Edge запускается отдельным процессом: scripts/RunEdgeOBD.ps1 (user_01, порт 9226).
 *  - Учитывает ДВА типа карточек на obd-memorial.ru:
 *      1) «Информация из документов, уточняющих потери» (поля: Дата выбытия, Причина выбытия,
 *         Первичное место захоронения, ...)
 *      2) «Информация из списков захоронения» (поля: Дата смерти, Страна/Регион/Место захоронения,
 *         Откуда перезахоронен, ... без «Причины выбытия»)
 *  - Классификация «убит/погиб» — свежая редакция (см. classify()).
 *
 * ЗАПУСК:
 *   pwsh scripts/RunEdgeOBD.ps1          # поднять Edge c CDP на 9226
 *   node obd-edge.js                     # полный прогон
 *   node obd-edge.js --dry-run           # только показать, что будет обработано
 *   node obd-edge.js --port 9227         # другой порт при необходимости
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ---------- Параметры ----------
const DEFAULT_PORT = 9226;
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const portArg = args.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1], 10) : DEFAULT_PORT;

// Задержка для щадящей нагрузки на портал
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Экранирование значения для CSV
function escapeCsv(value) {
  if (typeof value !== 'string') return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Функция сохранения CSV (UTF-8 с BOM)
function saveCsv(filepath, headers, rows) {
  if (rows.length === 0) return;
  const csvRows = rows.map(row => {
    return headers.map(header => {
      const key = header.toLowerCase();
      return escapeCsv(row[key] || row[header] || '');
    }).join(',');
  });
  const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
  fs.writeFileSync(filepath, csvContent, 'utf-8');
}

(async () => {
  const inputFile = path.join(__dirname, 'data', 'raw', 'input_urls.txt');
  const processedFile = path.join(__dirname, 'data', 'processed_urls.txt');
  const logsDir = path.join(__dirname, 'data', 'processed', 'logs');

  fs.mkdirSync(logsDir, { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  const killedFile = path.join(logsDir, `${today}__parser_mem2026.csv`);
  const otherFile = path.join(logsDir, `${today}__other_mem2026_.csv`);
  const sessionLogFile = path.join(logsDir, `${today}__session.log`);
  const errorsLogFile = path.join(logsDir, `${today}__errors.log`);

  function log(msg) {
    console.log(msg);
    fs.appendFileSync(sessionLogFile, msg + '\n', 'utf-8');
  }

  function logError(msg) {
    console.error(msg);
    fs.appendFileSync(sessionLogFile, '[ERROR] ' + msg + '\n', 'utf-8');
    fs.appendFileSync(errorsLogFile, msg + '\n', 'utf-8');
  }

  if (isDryRun) {
    log(`🔍 DRY-RUN: подключение к Edge CDP localhost:${PORT}...`);
  } else {
    log(`🚀 Запуск парсера OBD Memorial через Edge CDP localhost:${PORT}`);
  }

  if (!fs.existsSync(inputFile)) {
    logError('❌ Файл не найден: data/raw/input_urls.txt');
    process.exit(1);
  }

  // Чтение списка URL: пропускаем пустые строки и комментарии (#)
  const allUrls = fs.readFileSync(inputFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  if (allUrls.length === 0) {
    logError('❌ Файл data/raw/input_urls.txt пуст (только комментарии). Добавьте адреса.');
    process.exit(1);
  }

  // Возобновление после краша
  const processedSet = new Set();
  if (fs.existsSync(processedFile)) {
    const processed = fs.readFileSync(processedFile, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    processed.forEach(url => processedSet.add(url));
    log(`♻️  Найдено ${processedSet.size} уже обработанных URL — пропускаем`);
  }

  const urls = allUrls.filter(url => !processedSet.has(url));
  if (urls.length === 0) {
    log('✅ Все URL уже обработаны');
    process.exit(0);
  }

  log(`📄 Всего URL: ${allUrls.length}, осталось обработать: ${urls.length}`);
  log(`📁 Результаты: ${killedFile}`);
  log(`📁 Результаты: ${otherFile}`);
  log(`📁 Лог сессии: ${sessionLogFile}`);
  log(`📁 Лог ошибок: ${errorsLogFile}`);

  // ---------- Подключение к Edge по CDP ----------
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${PORT}`,
      defaultViewport: null,
    });
    log(`🔗 Подключено к Edge CDP localhost:${PORT}`);
  } catch (e) {
    logError(`❌ Не удалось подключиться к Edge CDP localhost:${PORT}.`);
    logError(`   Сначала запустите: pwsh scripts/RunEdgeOBD.ps1`);
    logError(`   Ошибка: ${e.message}`);
    process.exit(1);
  }

  const page = await browser.newPage();

  const headers = [
    'Заголовок',
    'nomer_fonda',
    'nomer_opisi',
    'nomer_dela',
    'document_type',
    'document_id',
    'last_name',
    'first_name',
    'middle_name',
    'date_birth',
    'place_birth',
    'date_death',
    'rank',
    'warunit',
    'cause_of_death',
    'primary_burial',
    'current_burial',
    'conscription_location',
    'primary_url',
    'notes',
    'Дата'
  ];

  // Известные заголовки параметров (стандартные) — не попадают в extra-поиск notes
  const knownTitles = [
    'Фамилия',
    'Имя',
    'Отчество',
    'Дата рождения',
    'Место рождения',
    'Дата выбытия',
    'Дата смерти',
    'Воинское звание',
    'Последнее место службы',
    'Причина выбытия',
    'Первичное место захоронения',
    'Номер фонда источника информации',
    'Номер описи источника информации',
    'Номер дела источника информации',
    'Название источника донесения',
    'Место захоронения',
    'Место призыва',
    'Страна захоронения',
    'Регион захоронения',
    'Откуда перезахоронен'
  ];

  // ---------- Свежая редакция классификации «убит/погиб» ----------
  // Правила:
  //  1. Если Причина выбытия содержит «убит» или «погиб» → killed.
  //  2. Если причина НЕ указана, но есть «Дата смерти» (тип «списки захоронения»)
  //     и есть захоронение (первичное/место) → killed (это погибший из списка захоронения).
  //  3. Во всех остальных случаях → other (причина/особенности уходят в notes).
  function classify(data) {
    const cause = (data.cause_of_death || '').toLowerCase().trim();
    if (cause.includes('убит') || cause.includes('погиб')) {
      return 'killed';
    }
    const hasDeathDate = !!(data.date_death || '').trim();
    const hasBurial = !!((data.primary_burial || '').trim() || (data.current_burial || '').trim());
    if (!cause && hasDeathDate && hasBurial) {
      return 'killed';
    }
    return 'other';
  }

  const killed = [];
  const other = [];
  let processedCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const globalIndex = allUrls.indexOf(url) + 1;
    log(`\n[${globalIndex}/${allUrls.length}] ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(3000); // пауза для полной отрисовки DOM

      // Сбор данных со страницы (аналог F12-скрипта, но универсальный под оба типа карточек)
      const data = await page.evaluate((knownTitles) => {
        function getParamValue(title) {
          const elements = document.querySelectorAll('.card_parameter');
          for (let el of elements) {
            const titleSpan = el.querySelector('.card_param-title');
            if (titleSpan && titleSpan.innerText.trim() === title) {
              const valueSpan = el.querySelector('.card_param-result');
              return valueSpan ? valueSpan.innerText.trim() : '';
            }
          }
          return '';
        }

        // Собираем ВСЕ пары «заголовок → значение» для анализа типа карточки
        const allParams = {};
        const elements = document.querySelectorAll('.card_parameter');
        for (let el of elements) {
          const titleSpan = el.querySelector('.card_param-title');
          const valueSpan = el.querySelector('.card_param-result');
          if (titleSpan && valueSpan) {
            allParams[titleSpan.innerText.trim()] = valueSpan.innerText.trim();
          }
        }

        const result = {
          last_name:        getParamValue('Фамилия'),
          first_name:       getParamValue('Имя'),
          middle_name:      getParamValue('Отчество'),
          date_birth:       getParamValue('Дата рождения'),
          place_birth:      getParamValue('Место рождения'),
          // Дата выбытия (тип 1) или Дата смерти (тип 2)
          date_death:       getParamValue('Дата выбытия') || getParamValue('Дата смерти'),
          rank:             getParamValue('Воинское звание'),
          warunit:          getParamValue('Последнее место службы'),
          cause_of_death:   getParamValue('Причина выбытия'),
          primary_burial:   getParamValue('Первичное место захоронения'),
          nomer_fonda:      getParamValue('Номер фонда источника информации'),
          nomer_opisi:      getParamValue('Номер описи источника информации'),
          nomer_dela:       getParamValue('Номер дела источника информации'),
          document_type:    getParamValue('Название источника донесения'),
          // Тип 2: «Место захоронения»; если нет — fallback на «Первичное место захоронения»
          current_burial:   getParamValue('Место захоронения') || getParamValue('Первичное место захоронения'),
          conscription_location: getParamValue('Место призыва'),
          primary_url:      window.location.href,
        };

        // document_id: id_common или из URL
        const idCommon = document.querySelector('[id_common]')?.getAttribute('id_common');
        if (idCommon) {
          result.document_id = idCommon;
        } else {
          const urlMatch = window.location.href.match(/id=(\d+)/);
          if (urlMatch) result.document_id = urlMatch[1];
        }

        result.заголовок = `${result.last_name} ${result.first_name} ${result.middle_name}`.trim();
        result.Дата = new Date().toISOString().split('T')[0];

        // Сохраняем «сырой» список всех параметров для анализа в notes
        result._allParams = allParams;

        return result;
      }, knownTitles);

      // Определяем категорию
      const category = classify(data);
      const isKilled = category === 'killed';

      // Формируем notes
      let notesParts = [];

      // Если не «убит/погиб» и причина есть — добавляем причину в notes
      if (!isKilled && data.cause_of_death) {
        notesParts.push(data.cause_of_death);
      }

      // Если это тип «списки захоронения» (есть «Откуда перезахоронен») — фиксируем в notes
      if (data._allParams['Откуда перезахоронен']) {
        notesParts.push(`Откуда перезахоронен: ${data._allParams['Откуда перезахоронен']}`);
      }
      // Страна/Регион захоронения (тип 2) — тоже в notes, если есть
      if (data._allParams['Страна захоронения']) {
        notesParts.push(`Страна захоронения: ${data._allParams['Страна захоронения']}`);
      }
      if (data._allParams['Регион захоронения']) {
        notesParts.push(`Регион захоронения: ${data._allParams['Регион захоронения']}`);
      }

      // Если архивные поля пусты — ищем альтернативные параметры
      const archiveFieldsEmpty = !data.nomer_fonda && !data.nomer_opisi && !data.nomer_dela && !data.document_type;
      if (archiveFieldsEmpty) {
        const extraParams = Object.entries(data._allParams)
          .filter(([title]) => !knownTitles.includes(title))
          .map(([title, value]) => `${title}: ${value}`)
          .join('; ');
        if (extraParams) {
          notesParts.push(extraParams);
        }
      }

      // Убираем служебное поле _allParams из выгрузки
      delete data._allParams;
      data.notes = notesParts.join(' | ');

      if (isKilled) {
        killed.push(data);
        log(`   ✅ убит/погиб — добавлен в ${today}__parser_mem2026.csv`);
      } else {
        other.push(data);
        log(`   ⚠️  другое ("${data.cause_of_death || 'не указано'}") — добавлен в ${today}__other_mem2026_.csv`);
      }

      // Отмечаем URL как обработанный
      if (!isDryRun) {
        fs.appendFileSync(processedFile, url + '\n', 'utf-8');
      }
      processedCount++;

      // Промежуточное сохранение каждые 50 записей
      if (!isDryRun && processedCount % 50 === 0) {
        log(`   💾 Промежуточное сохранение (${processedCount} обработано)...`);
        saveCsv(killedFile, headers, killed);
        saveCsv(otherFile, headers, other);
      }

      await delay(2000);

    } catch (err) {
      logError(`   ❌ Ошибка: ${err.message}`);
      if (!isDryRun) {
        log(`   💾 Сохранение промежуточных результатов...`);
        saveCsv(killedFile, headers, killed);
        saveCsv(otherFile, headers, other);
      }
      await delay(2000);
    }
  }

  await browser.disconnect();

  if (!isDryRun) {
    log('\n📊 Финальное сохранение результатов...');
    saveCsv(killedFile, headers, killed);
    saveCsv(otherFile, headers, other);

    log(`   💾 ${today}__parser_mem2026.csv — ${killed.length} записей`);
    log(`   💾 ${today}__other_mem2026_.csv — ${other.length} записей`);
  } else {
    log(`\n📊 DRY-RUN завершён. Обработано (смоделировано): ${processedCount}`);
    log(`   killed: ${killed.length}, other: ${other.length}`);
    log('   Файлы НЕ записаны, журнал processed_urls НЕ изменён.');
  }

  log('\n✅ Готово!');
})();