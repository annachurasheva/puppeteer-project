/**
 * check-input.js — контроль входных файлов ПЕРЕД запуском парсера.
 *
 * Что делает:
 *  - для каждого .txt в data/raw/ (или для --file=имя.txt) считает:
 *      * всего строк (URL);
 *      * уникальных URL;
 *      * дублей ВНУТРИ файла (адрес повторяется несколько раз);
 *      * сколько URL уже обработаны (по журналу data/processed/<имя>/ и по
 *        глобальной сумме data/summary/processed_ids.txt).
 *  - выводит расхождения на экран (ничего не пишет в файлы).
 *
 * Запуск:
 *   node scripts/check-input.js                 # все файлы в data/raw/
 *   node scripts/check-input.js --file=имя.txt  # один файл
 *
 * ВАЖНО: это инструмент контроля, он НЕ запускает парсер.
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');
const PROCESSED_DIR = path.join(__dirname, '..', 'data', 'processed');
const SUMMARY_FILE = path.join(__dirname, '..', 'data', 'summary', 'processed_ids.txt');

const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='));
const FILE = fileArg ? fileArg.split('=')[1] : null;

function extractIdFromUrl(url) {
  const match = url.match(/id=(\d+)/);
  return match ? match[1] : '';
}

function readLines(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

function loadSet(filepath) {
  return new Set(readLines(filepath));
}

function checkFile(filepath) {
  const baseName = path.basename(filepath, path.extname(filepath));
  console.log(`\n===== ${baseName} =====`);

  const urls = readLines(filepath);
  if (urls.length === 0) {
    console.log('   (пусто или только комментарии)');
    return;
  }

  // Уникальные и дубли внутри файла
  const countMap = new Map();
  for (const url of urls) {
    countMap.set(url, (countMap.get(url) || 0) + 1);
  }
  const uniqueUrls = [...countMap.keys()];
  const dupUrls = [...countMap.entries()].filter(([, n]) => n > 1);

  console.log(`   Всего строк (URL): ${urls.length}`);
  console.log(`   Уникальных адресов: ${uniqueUrls.length}`);

  if (dupUrls.length > 0) {
    console.log(`   ⚠️  Дублей ВНУТРИ файла: ${dupUrls.length} адресов повторяются:`);
    for (const [url, n] of dupUrls) {
      console.log(`      ×${n}  ${url}`);
    }
  } else {
    console.log(`   ✅ Внутри файла дублей нет`);
  }

  // Журнал этого файла
  const processedFile = path.join(PROCESSED_DIR, baseName, `${baseName}__processed.txt`);
  const processedSet = loadSet(processedFile);
  const alreadyInJournal = uniqueUrls.filter(url => processedSet.has(url)).length;

  // Глобальная сумма
  const summaryIds = loadSet(SUMMARY_FILE);
  const alreadyInSummary = uniqueUrls.filter(url => {
    const id = extractIdFromUrl(url);
    return id && summaryIds.has(id);
  }).length;

  // Сколько «новых» осталось обработать
  const newUrls = uniqueUrls.filter(url => {
    if (processedSet.has(url)) return false;
    const id = extractIdFromUrl(url);
    if (id && summaryIds.has(id)) return false;
    return true;
  });

  console.log(`   Уже в журнале файла: ${alreadyInJournal}`);
  console.log(`   Уже в глобальной сумме: ${alreadyInSummary}`);
  console.log(`   🆕 Новых к обработке: ${newUrls.length}`);

  if (newUrls.length > 0) {
    console.log(`   Первые несколько новых:`);
    for (const url of newUrls.slice(0, 5)) {
      console.log(`      ${url}`);
    }
  }
}

// ---------- Главная ----------
if (!fs.existsSync(RAW_DIR)) {
  console.error(`❌ Папка не найдена: data/raw/`);
  process.exit(1);
}

let files = [];
if (FILE) {
  const p = path.join(RAW_DIR, FILE);
  if (!fs.existsSync(p)) {
    console.error(`❌ Файл не найден: data/raw/${FILE}`);
    process.exit(1);
  }
  files = [p];
} else {
  files = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(f => path.join(RAW_DIR, f))
    .sort();
}

if (files.length === 0) {
  console.log('В data/raw/ нет ни одного .txt файла.');
  process.exit(0);
}

console.log(`📂 Файлов для проверки: ${files.length}`);
console.log(`📊 Глобальная сумма: ${SUMMARY_FILE}`);

for (const file of files) {
  checkFile(file);
}

console.log('\n✅ Проверка завершена. Запускайте парсер: node obd-edge.js');