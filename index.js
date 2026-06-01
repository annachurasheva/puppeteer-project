const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Задержка для щадящей нагрузки на портал
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('❌ Укажите URL карточки персоны OBD Memorial');
    console.error('   Пример: node index.js "https://obd-memorial.ru/html/info.htm?id=..."');
    process.exit(1);
  }

  console.log('🚀 Запуск парсера OBD Memorial...');
  console.log(`📎 URL: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Users\\An\\.cache\\puppeteer\\chrome-headless-shell\\win64-148.0.7778.97\\chrome-headless-shell.exe'
  });

  const page = await browser.newPage();

  // Шаг 1: Переход на страницу с ожиданием полной загрузки
  console.log('⏳ Загрузка страницы...');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Пауза для полной отрисовки DOM (чтобы не нагружать портал)
  await delay(3000);

  // Шаг 2: Извлечение данных (адаптированный F12-скрипт)
  console.log('🔍 Извлечение данных...');
  const data = await page.evaluate(() => {
    // Функция получения значения параметра по заголовку
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

    // Сбор данных
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

    // Получение document_id
    const idCommon = document.querySelector('[id_common]')?.getAttribute('id_common');
    if (idCommon) {
      result.document_id = idCommon;
    } else {
      const urlMatch = window.location.href.match(/id=(\d+)/);
      if (urlMatch) result.document_id = urlMatch[1];
    }

    // Заголовок и дата
    result.заголовок = `${result.last_name} ${result.first_name} ${result.middle_name}`.trim();
    result.Дата = new Date().toISOString().split('T')[0];

    return result;
  });

  // Пауза перед закрытием
  await delay(1000);
  await browser.close();

  // Шаг 3: Формирование CSV
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

  const row = headers.map(header => {
    const key = header.toLowerCase();
    let value = data[key] || data[header] || '';
    if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
      value = '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  });

  const csvContent = '\uFEFF' + [headers.join(','), row.join(',')].join('\n');

  // Сохранение в папку data
  const outputDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `person_${data.document_id || Date.now()}.csv`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, csvContent, 'utf-8');

  console.log(`✅ CSV сохранён: ${filepath}`);
  console.log(`👤 ${data.заголовок || 'данные не найдены'}`);
})();