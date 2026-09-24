/**
 * obd-edge_v03.js — парсер карточек OBD Memorial (obd-memorial.ru), ВЕРСИЯ 03
 *
 * ОТЛИЧИЯ ОТ obd-edge.js:
 *  1. Новые колонки CSV: country_burial, region_burial, rebural_from.
 *     («Страна захоронения», «Регион захоронения», «Откуда перезахоронен» —
 *      только если есть в карточке.)
 *  2. current_burial БЕЗ fallback на «Первичное место захоронения»:
 *     берётся только «Место захоронения». Конфликта нет:
 *       - primary_burial  → как указано (первичное)
 *       - current_burial  → как указано (фактическое)
 *     Мы делаем копию документа, по которой можно вести переписку причастным.
 *     Сами ничего не придумываем.
 *  3. notes — используется как ТОРМОЗ: если с карточкой что-то не так,
 *     без проверки она не появляется. В notes попадают только нестандартные/
 *     проблемные данные (причина, если не «убит/погиб»; неизвестные поля,
 *     если архивные реквизиты пусты). Новые поля страны/региона/перезахоронения
 *     в notes НЕ дублируются — они теперь отдельные колонки.
 *
 * ЗАПУСК:
 *   Edge с remote-debugging: pwsh scripts/RunEdgeOBD.ps1  (порт 9226)
 *   node obd-edge_v03.js
 *   node obd-edge_v03.js --input=имя.txt
 *   node obd-edge_v03.js --dry-run
 *   node obd-edge_v03.js --port=9227
 *
 * ВЫХОД (для каждого входного файла <имя>):
 *   data/processed/<имя>/
 *     <имя>__parser_mem2026.csv     — убит/погиб
 *     <имя>__other_mem2026_.csv     — остальные причины
 *     <имя>__session.log
 *     <имя>__errors.log
 *     <имя>__processed.txt
 *   data/summary/processed_ids.txt
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
const inputArg = args.find(a => a.startsWith('--input='));
const INPUT_FILE = inputArg ? inputArg.split('=')[1] : null;

// ---------- Задержки (рандомизация, чтобы не походить на бота) ----------
const MIN_AFTER_LOAD = 3000;
const MAX_AFTER_LOAD = 6000;
const MIN_BETWEEN = 3000;
const MAX_BETWEEN = 15000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  const value = Math.floor(min + Math.random() * (max - min + 1));
  return delay(value);
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

// Извлечение id из URL (хвост адреса): https://obd-memorial.ru/html/info.htm?id=551267195 -> 551267195
function extractIdFromUrl(url) {
  const match = url.match(/id=(\d+)/);
  return match ? match[1] : '';
}

// Чтение файла со списком URL: пропускаем пустые строки и комментарии (#)
function readUrlList(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

// Загрузка множества из файла (по одной записи на строку)
function loadSet(filepath) {
  const set = new Set();
  if (fs.existsSync(filepath)) {
    fs.readFileSync(filepath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .forEach(line => set.add(line));
  }
  return set;
}

// ---------- Обработка одного входного файла ----------
async function processInputFile(browser, inputFile) {
  const baseName = path.basename(inputFile, path.extname(inputFile));
  const outDir = path.join(__dirname, 'data', 'processed', baseName);
  const summaryFile = path.join(__dirname, 'data', 'summary', 'processed_ids.txt');

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  const killedFile = path.join(outDir, `${baseName}__parser_mem2026.csv`);
  const otherFile = path.join(outDir, `${baseName}__other_mem2026_.csv`);
  const sessionLogFile = path.join(outDir, `${baseName}__session.log`);
  const errorsLogFile = path.join(outDir, `${baseName}__errors.log`);
  const processedFile = path.join(outDir, `${baseName}__processed.txt`);

  function log(msg) {
    console.log(msg);
    if (!isDryRun) fs.appendFileSync(sessionLogFile, msg + '\n', 'utf-8');
  }

  function logError(msg) {
    console.error(msg);
    if (!isDryRun) {
      fs.appendFileSync(sessionLogFile, '[ERROR] ' + msg + '\n', 'utf-8');
      fs.appendFileSync(errorsLogFile, msg + '\n', 'utf-8');
    }
  }

  log(`\n===== Файл: ${baseName} =====`);
  if (isDryRun) {
    log(`🔍 DRY-RUN: подключение к Edge CDP localhost:${PORT}...`);
  }

  const allUrls = readUrlList(inputFile);
  if (allUrls.length === 0) {
    logError(`❌ В файле ${baseName} нет ни одного URL (только комментарии). Пропускаю.`);
    return;
  }

  // --- Контроль дублей внутри файла ---
  const urlCount = new Map();
  for (const url of allUrls) {
    urlCount.set(url, (urlCount.get(url) || 0) + 1);
  }
  const internalDuplicates = [...urlCount.entries()].filter(([, n]) => n > 1);
  if (internalDuplicates.length > 0) {
    log(`⚠️  Внутренние дубли в файле (${internalDuplicates.length} адресов повторяются):`);
    for (const [url, n] of internalDuplicates) {
      log(`   ×${n}  ${url}`);
    }
  }

  // --- Журнал этого файла + глобальная сумма ---
  const processedSet = loadSet(processedFile);
  const summaryIds = loadSet(summaryFile);

  if (processedSet.size > 0) {
    log(`♻️  В журнале файла: ${processedSet.size} уже обработанных URL — пропускаем`);
  }

  // Отбираем URL, которые ещё не обрабатывались:
  // 1) нет в журнале файла (полный URL)
  // 2) id нет в глобальной сумме
  const urlsToProcess = allUrls.filter((url) => {
    if (processedSet.has(url)) return false;
    const id = extractIdFromUrl(url);
    if (id && summaryIds.has(id)) return false;
    return true;
  });

  const skippedBySummary = allUrls.length - urlsToProcess.length - processedSet.size;
  if (skippedBySummary > 0) {
    log(`♻️  Из них ${skippedBySummary} уже есть в глобальной сумме (data/summary/processed_ids.txt) — пропускаем`);
  }

  if (urlsToProcess.length === 0) {
    log('✅ Все URL уже обработаны (журнал файла + сумма).');
    return;
  }

  log(`📄 Всего URL: ${allUrls.length}, осталось обработать: ${urlsToProcess.length}`);
  log(`📁 Результаты: ${killedFile}`);
  log(`📁 Результаты: ${otherFile}`);

  // Итоговые заголовки CSV — v03: добавлены country_burial, region_burial, rebural_from
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
    'country_burial',
    'region_burial',
    'rebural_from',
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

  // ---------- Классификация «убит/погиб» ----------
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

  const page = await browser.newPage();

  const killed = [];
  const other = [];
  let processedCount = 0;

  for (let i = 0; i < urlsToProcess.length; i++) {
    const url = urlsToProcess[i];
    const globalIndex = i + 1;
    log(`\n[${globalIndex}/${urlsToProcess.length}] ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await randomDelay(MIN_AFTER_LOAD, MAX_AFTER_LOAD); // пауза для полной отрисовки DOM

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
          // Тип 2: «Место захоронения» — БЕЗ fallback на первичное (v03)
          current_burial:   getParamValue('Место захоронения'),
          // Новые поля (v03) — только если есть в карточке
          country_burial:   getParamValue('Страна захоронения'),
          region_burial:    getParamValue('Регион захоронения'),
          rebural_from:     getParamValue('Откуда перезахоронен'),
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

      // Формируем notes — ТОРМОЗ: если с карточкой что-то не так,
      // без проверки она не появляется. Сюда попадают только проблемные/нестандартные данные.
      let notesParts = [];

      // Если не «убит/погиб» и причина есть — добавляем причину в notes
      if (!isKilled && data.cause_of_death) {
        notesParts.push(data.cause_of_death);
      }

      // Если архивные поля пусты — ищем альтернативные/нестандартные параметры
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
        log(`   ✅ убит/погиб — добавлен в ${baseName}__parser_mem2026.csv`);
      } else {
        other.push(data);
        log(`   ⚠️  другое ("${data.cause_of_death || 'не указано'}") — добавлен в ${baseName}__other_mem2026_.csv`);
      }

      // Отмечаем как обработанное: полный URL в журнал файла, id в глобальную сумму
      if (!isDryRun) {
        fs.appendFileSync(processedFile, url + '\n', 'utf-8');
        const id = extractIdFromUrl(url) || data.document_id || '';
        if (id) {
          fs.appendFileSync(summaryFile, id + '\n', 'utf-8');
        }
      }
      processedCount++;

      // Промежуточное сохранение каждые 50 записей
      if (!isDryRun && processedCount % 50 === 0) {
        log(`   💾 Промежуточное сохранение (${processedCount} обработано)...`);
        saveCsv(killedFile, headers, killed);
        saveCsv(otherFile, headers, other);
      }

      await randomDelay(MIN_BETWEEN, MAX_BETWEEN);

    } catch (err) {
      logError(`   ❌ Ошибка: ${err.message}`);
      if (!isDryRun) {
        log(`   💾 Сохранение промежуточных результатов...`);
        saveCsv(killedFile, headers, killed);
        saveCsv(otherFile, headers, other);
      }
      await randomDelay(MIN_BETWEEN, MAX_BETWEEN);
    }
  }

  await page.close();

  if (!isDryRun) {
    log('\n📊 Финальное сохранение результатов...');
    saveCsv(killedFile, headers, killed);
    saveCsv(otherFile, headers, other);

    log(`   💾 ${baseName}__parser_mem2026.csv — ${killed.length} записей`);
    log(`   💾 ${baseName}__other_mem2026_.csv — ${other.length} записей`);
  } else {
    log(`\n📊 DRY-RUN (${baseName}) завершён. Обработано (смоделировано): ${processedCount}`);
    log(`   killed: ${killed.length}, other: ${other.length}`);
    log('   Файлы НЕ записаны, журналы/сумма НЕ изменены.');
  }
}

// ---------- Главная функция ----------
(async () => {
  const rawDir = path.join(__dirname, 'data', 'raw');

  // Определяем список входных файлов
  let inputFiles = [];
  if (INPUT_FILE) {
    const p = path.join(rawDir, INPUT_FILE);
    if (!fs.existsSync(p)) {
      console.error(`❌ Файл не найден: data/raw/${INPUT_FILE}`);
      process.exit(1);
    }
    inputFiles = [p];
  } else {
    if (!fs.existsSync(rawDir)) {
      console.error(`❌ Папка не найдена: data/raw/`);
      process.exit(1);
    }
    inputFiles = fs.readdirSync(rawDir)
      .filter(f => f.endsWith('.txt'))
      .map(f => path.join(rawDir, f))
      .sort();
  }

  if (inputFiles.length === 0) {
    console.error('❌ В data/raw/ нет ни одного .txt файла. Положите список URL.');
    process.exit(1);
  }

  console.log(`📂 Входных файлов: ${inputFiles.length}`);
  for (const f of inputFiles) {
    console.log(`   - ${path.basename(f)}`);
  }

  // Подключение к Edge по CDP
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${PORT}`,
      defaultViewport: null,
    });
    console.log(`🔗 Подключено к Edge CDP localhost:${PORT}`);
  } catch (e) {
    console.error(`❌ Не удалось подключиться к Edge CDP localhost:${PORT}.`);
    console.error(`   Сначала запустите: pwsh scripts/RunEdgeOBD.ps1`);
    console.error(`   Ошибка: ${e.message}`);
    process.exit(1);
  }

  for (const file of inputFiles) {
    await processInputFile(browser, file);
  }

  await browser.disconnect();
  console.log('\n✅ Готово!');
})();