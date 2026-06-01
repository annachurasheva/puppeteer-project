const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

(async () => {
  const inputFile = path.join(__dirname, 'data', 'raw', 'input_urls.txt');

  if (!fs.existsSync(inputFile)) {
    console.error('❌ Файл не найден: data/raw/input_urls.txt');
    process.exit(1);
  }

  // Чтение списка URL
  const urls = fs.readFileSync(inputFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (urls.length === 0) {
    console.error('❌ Файл data/raw/input_urls.txt пуст');
    process.exit(1);
  }

  console.log(`🚀 Запуск парсера OBD Memorial`);
  console.log(`📄 Найдено URL: ${urls.length}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Users\\An\\.cache\\puppeteer\\chrome-headless-shell\\win64-148.0.7778.97\\chrome-headless-shell.exe'
  });

  const page = await browser.newPage();

  // Массивы для разделения результатов
  const killed = [];   // "убит" / "погиб"
  const other = [];    // всё остальное

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

  // Известные заголовки параметров (стандартные)
  const knownTitles = [
    'Фамилия',
    'Имя',
    'Отчество',
    'Дата рождения',
    'Место рождения',
    'Дата выбытия',
    'Воинское звание',
    'Последнее место службы',
    'Причина выбытия',
    'Первичное место захоронения',
    'Номер фонда источника информации',
    'Номер описи источника информации',
    'Номер дела источника информации',
    'Название источника донесения',
    'Место захоронения',
    'Место призыва'
  ];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      // Пауза для полной отрисовки DOM
      await delay(3000);

      const data = await page.evaluate(() => {
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

        const result = {
          last_name:        getParamValue('Фамилия'),
          first_name:       getParamValue('Имя'),
          middle_name:      getParamValue('Отчество'),
          date_birth:       getParamValue('Дата рождения'),
          place_birth:      getParamValue('Место рождения'),
          date_death:       getParamValue('Дата выбытия'),
          rank:             getParamValue('Воинское звание'),
          warunit:          getParamValue('Последнее место службы'),
          cause_of_death:   getParamValue('Причина выбытия'),
          primary_burial:   getParamValue('Первичное место захоронения'),
          nomer_fonda:      getParamValue('Номер фонда источника информации'),
          nomer_opisi:      getParamValue('Номер описи источника информации'),
          nomer_dela:       getParamValue('Номер дела источника информации'),
          document_type:    getParamValue('Название источника донесения'),
          current_burial:   getParamValue('Место захоронения'),
          conscription_location: getParamValue('Место призыва'),
          primary_url:      window.location.href,
        };

        const idCommon = document.querySelector('[id_common]')?.getAttribute('id_common');
        if (idCommon) {
          result.document_id = idCommon;
        } else {
          const urlMatch = window.location.href.match(/id=(\d+)/);
          if (urlMatch) result.document_id = urlMatch[1];
        }

        result.заголовок = `${result.last_name} ${result.first_name} ${result.middle_name}`.trim();
        result.Дата = new Date().toISOString().split('T')[0];

        return result;
      });

      // Определяем категорию по полю "Причина выбытия"
      const cause = (data.cause_of_death || '').toLowerCase().trim();
      const isKilled = cause.includes('убит') || cause.includes('погиб');

      // Формируем notes
      let notesParts = [];

      // Если причина не "убит"/"погиб" — добавляем причину в notes
      if (!isKilled && data.cause_of_death) {
        notesParts.push(data.cause_of_death);
      }

      // Если архивные поля пусты — ищем альтернативные параметры на странице
      const archiveFieldsEmpty = !data.nomer_fonda && !data.nomer_opisi && !data.nomer_dela && !data.document_type;
      if (archiveFieldsEmpty) {
        const extraParams = await page.evaluate((knownTitles) => {
          const extras = [];
          const elements = document.querySelectorAll('.card_parameter');
          for (let el of elements) {
            const titleSpan = el.querySelector('.card_param-title');
            const valueSpan = el.querySelector('.card_param-result');
            if (titleSpan && valueSpan) {
              const title = titleSpan.innerText.trim();
              if (!knownTitles.includes(title)) {
                extras.push(`${title}: ${valueSpan.innerText.trim()}`);
              }
            }
          }
          return extras.join('; ');
        }, knownTitles);

        if (extraParams) {
          notesParts.push(extraParams);
        }
      }

      data.notes = notesParts.join(' | ');

      if (isKilled) {
        killed.push(data);
        console.log(`   ✅ убит/погиб — добавлен в killed.csv`);
      } else {
        other.push(data);
        console.log(`   ⚠️  другое ("${data.cause_of_death || 'не указано'}") — добавлен в other.csv`);
      }

      // Пауза перед следующим запросом
      await delay(2000);

    } catch (err) {
      console.error(`   ❌ Ошибка: ${err.message}`);
      await delay(2000);
    }
  }

  await browser.close();

  // Функция сохранения CSV
  function saveCsv(filename, rows) {
    if (rows.length === 0) {
      console.log(`   ⏭  ${filename} — нет записей, файл не создан`);
      return;
    }

    const csvRows = rows.map(row => {
      return headers.map(header => {
        const key = header.toLowerCase();
        return escapeCsv(row[key] || row[header] || '');
      }).join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
    const filepath = path.join(__dirname, 'data', filename);
    fs.writeFileSync(filepath, csvContent, 'utf-8');
    console.log(`   💾 ${filename} — ${rows.length} записей`);
  }

  console.log('\n📊 Сохранение результатов...');
  saveCsv('killed.csv', killed);
  saveCsv('other.csv', other);

  console.log('\n✅ Готово!');
})();