/**
 * obd-edge-objects.js — парсер карточек «Информация о захоронении»
 * (объекты гос-регистрации захоронений ВОВ, obd-memorial.ru)
 *
 * ЗАДАЧА:
 *   Из списка primary_url (например, собранного F12-сборщиком со страницы
 *   поиска) составить *.csv с объектами «Захоронения ВОВ».
 *
 * ЗАПУСК:
 *   Edge с remote-debugging: pwsh scripts/RunEdgeOBD.ps1   (порт 9226)
 *   node obd-edge-objects.js objects.txt
 *   node obd-edge-objects.js objects.txt --dry-run
 *   node obd-edge-objects.js objects.txt --port=9227
 *
 * ВХОД:
 *   objects.txt — список primary_url вида:
 *     https://obd-memorial.ru/html/info.htm?id=1167839469
 *   (по одной ссылке на строку; пустые строки и строки с # пропускаются)
 *
 * ВЫХОД:
 *   obyekty_zahoroneniya_VOV.csv — рядом со скриптом (UTF-8 с BOM)
 *   obyekty_zahoroneniya_VOV.session.log — лог прогона
 *   obyekty_zahoroneniya_VOV.errors.log  — только ошибки
 *
 * ОСОБЕННОСТИ:
 *   - Операция РАЗОВАЯ: контроль дублей и журнал processed НЕ нужны.
 *   - «Тормоз»/notes НЕ используется: объекты пишутся как есть.
 *   - Персон не парсит. Тип файла не определяет.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ---------- Параметры ----------
const DEFAULT_PORT = 9226;

// Аргументы: позиционный <файл.txt>, флаги --dry-run, --port=
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const portArg = args.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1], 10) : DEFAULT_PORT;

// Позиционный аргумент — файл со списком URL:
//   node obd-edge-objects.js objects.txt
const positional = args.filter(a => !a.startsWith('--'));
const INPUT_FILE = positional[0] || null;

// ---------- Куда писать результат ----------
const OUT_DIR = __dirname; // рядом со скриптом

// ---------- Имя выходного CSV (транслитом) ----------
const BASE_NAME = 'obyekty_zahoroneniya_VOV';
const OUT_CSV = `${BASE_NAME}.csv`;
const SESSION_LOG = `${BASE_NAME}.session.log`;
const ERRORS_LOG = `${BASE_NAME}.errors.log`;

// ---------- Задержки (рандомизация, чтобы не походить на бота) ----------
const MIN_AFTER_LOAD = 3000;
const MAX_AFTER_LOAD = 6000;
const MIN_BETWEEN = 3000;
const MAX_BETWEEN = 15000;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min, max) {
  return delay(Math.floor(min + Math.random() * (max - min + 1)));
}

// Экранирование значения для CSV
function escapeCsv(value) {
  if (typeof value !== 'string') return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Сохранение CSV (UTF-8 с BOM)
function saveCsv(filepath, headers, rows) {
  const csvRows = rows.map(row => {
    return headers.map(h => escapeCsv(row[h] || '')).join(',');
  });
  const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
  fs.writeFileSync(filepath, csvContent, 'utf-8');
}

// Извлечение id из URL: .../info.htm?id=1167839469 -> 1167839469
function extractIdFromUrl(url) {
  const m = url.match(/id=(\d+)/);
  return m ? m[1] : '';
}

// Чтение списка URL: пропускаем пустые строки и комментарии (#)
function readUrlList(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}

// ---------- Схема объектного CSV ----------
// Порядок — сверху вниз по карточке объекта + служебные в начале.
const headers = [
  'document_id',
  'primary_url',
  'country_burial',
  'region_burial',
  'vmc_number',
  'current_burial',
  'date_created',
  'date_last_burial',
  'burial_type',
  'burial_state',
  'graves_count',
  'buried_total',
  'buried_known',
  'buried_unknown',
  'sponsor',
  'rebural_from'
];

// ---------- Главная функция ----------
(async () => {
  if (!INPUT_FILE) {
    console.error('❌ Укажите файл со списком URL: node obd-edge-objects.js objects.txt');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(INPUT_FILE)
    ? INPUT_FILE
    : path.join(process.cwd(), INPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Файл не найден: ${inputPath}`);
    process.exit(1);
  }

  const urls = readUrlList(inputPath);
  if (urls.length === 0) {
    console.error('❌ В файле нет ни одного URL.');
    process.exit(1);
  }

  const outPath = path.join(OUT_DIR, OUT_CSV);
  const sessionLogPath = path.join(OUT_DIR, SESSION_LOG);
  const errorsLogPath = path.join(OUT_DIR, ERRORS_LOG);

  function log(msg) {
    console.log(msg);
    if (!isDryRun) fs.appendFileSync(sessionLogPath, msg + '\n', 'utf-8');
  }

  function logError(msg) {
    console.error(msg);
    if (!isDryRun) {
      fs.appendFileSync(sessionLogPath, '[ERROR] ' + msg + '\n', 'utf-8');
      fs.appendFileSync(errorsLogPath, msg + '\n', 'utf-8');
    }
  }

  log(`📂 Входной файл: ${inputPath}`);
  log(`📄 URL: ${urls.length}`);
  log(`📁 Результат: ${outPath}`);
  if (isDryRun) log('🔍 DRY-RUN');

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${PORT}`,
      defaultViewport: null,
    });
    log(`🔗 Подключено к Edge CDP localhost:${PORT}`);
  } catch (e) {
    console.error(`❌ Не удалось подключиться к Edge CDP localhost:${PORT}.`);
    console.error(`   Сначала запустите: pwsh scripts/RunEdgeOBD.ps1`);
    console.error(`   Ошибка: ${e.message}`);
    process.exit(1);
  }

  const page = await browser.newPage();
  const rows = [];
  let ok = 0;
  let err = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    log(`\n[${i + 1}/${urls.length}] ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await randomDelay(MIN_AFTER_LOAD, MAX_AFTER_LOAD);

      // Сбор данных с карточки «Информация о захоронении»
      const data = await page.evaluate(() => {
        function getParamValue(title) {
          const elements = document.querySelectorAll('.card_parameter');
          for (const el of elements) {
            const t = el.querySelector('.card_param-title');
            if (t && t.innerText.trim() === title) {
              const v = el.querySelector('.card_param-result');
              return v ? v.innerText.trim() : '';
            }
          }
          return '';
        }

        const result = {
          country_burial:  getParamValue('Страна захоронения'),
          region_burial:   getParamValue('Регион захоронения'),
          vmc_number:      getParamValue('Номер захоронения в ВМЦ'),
          current_burial:  getParamValue('Место захоронения'),
          date_created:    getParamValue('Дата создания современного места захоронения'),
          date_last_burial:getParamValue('Дата последнего захоронения'),
          burial_type:     getParamValue('Вид захоронения'),
          burial_state:    getParamValue('Состояние захоронения'),
          graves_count:    getParamValue('Количество могил'),
          buried_total:    getParamValue('Захоронено всего'),
          buried_known:    getParamValue('Захоронено известных'),
          buried_unknown:  getParamValue('Захоронено неизвестных'),
          sponsor:         getParamValue('Кто шефствует над захоронением'),
          rebural_from:    getParamValue('Откуда производились перезахоронения'),
          primary_url:     window.location.href
        };

        const urlMatch = window.location.href.match(/id=(\d+)/);
        if (urlMatch) result.document_id = urlMatch[1];

        return result;
      });

      rows.push(data);
      ok++;
      log(`   ✅ собрано`);
    } catch (e) {
      err++;
      logError(`   ❌ ${url} — ${e.message}`);
    }

    if (i < urls.length - 1) {
      await randomDelay(MIN_BETWEEN, MAX_BETWEEN);
    }
  }

  await page.close();
  await browser.disconnect();

  if (!isDryRun) {
    saveCsv(outPath, headers, rows);
    log(`\n💾 Сохранено: ${outPath} — ${rows.length} записей`);
  } else {
    log(`\n🔍 DRY-RUN: собрано ${rows.length}, ошибок ${err}, файл НЕ записан`);
  }

  log(`\n=== Отчёт ===`);
  log(`Успешно: ${ok}`);
  log(`Ошибок:  ${err}`);
  log('✅ Готово!');
})();