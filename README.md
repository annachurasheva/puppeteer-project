# Парсер карточки персоны OBD Memorial

Скрипт для автоматического извлечения данных с карточек персон сайта **ОБД Мемориал** ([obd-memorial.ru](http://obd-memorial.ru)) с помощью **Puppeteer** (безголовый Chrome).

## 🚀 Использование

```bash
node index.js
```

Скрипт:

1. Читает список URL из `data/raw/input_urls.txt` (по одному URL на строку)
2. Последовательно обрабатывает каждую карточку персоны через безголовый Chrome
3. Между запросами — паузы для щадящей нагрузки на портал
4. Разделяет результат на два CSV-файла

## 📁 Состав репозитория

- `index.js` — основной скрипт для Puppeteer
- `test.js` — тестовый скрипт проверки работы Puppeteer
- `на_странице_карточки_персоны_OBD_Memorial.txt` — оригинальный скрипт для консоли браузера (F12)
- `data/raw/input_urls.txt` — входной файл со списком URL для обработки
- `data/killed.csv` — результат: персоны с причиной выбытия "убит" или "погиб"
- `data/other.csv` — результат: персоны с другими причинами выбытия

## 📊 Логика разделения


|Причина выбытия|Файл|
|:---|:---|
|Содержит "убит" или "погиб"|`killed.csv`|
|Любая другая|`other.csv`|

Примеры причин, попадающих в `other.csv`:

- пропал без вести
- сдался в плен
- эвакуация в госпиталь
- умер от ран
- и т.д.

## 📝 Логика поля `notes`

Поле `notes` формируется по следующим правилам:

1. **Если причина выбытия НЕ "убит"/"погиб"** — в `notes` записывается значение поля "Причина выбытия"
2. **Если архивные поля пусты** (nomer_fonda, nomer_opisi, nomer_dela, document_type) — сканируются все параметры на странице, и неизвестные (не входящие в стандартный набор) добавляются в `notes`. Например: `выписка из военкомата: Заполненное_поле_наименованием_военкома`
3. Если срабатывают оба условия — значения объединяются через `|`

## 📋 Собираемые данные

Данные извлекаются как есть, без модификации (только текст).


|Поле|Описание|
|:---|:---|
|Заголовок|ФИО персоны|
|last_name|Фамилия|
|first_name|Имя|
|middle_name|Отчество|
|date_birth|Дата рождения|
|place_birth|Место рождения|
|date_death|Дата выбытия|
|rank|Воинское звание|
|warunit|Последнее место службы|
|cause_of_death|Причина выбытия|
|primary_burial|Первичное место захоронения|
|current_burial|Место захоронения|
|conscription_location|Место призыва|
|nomer_fonda|Номер фонда источника информации|
|nomer_opisi|Номер описи источника информации|
|nomer_dela|Номер дела источника информации|
|document_type|Название источника донесения|
|document_id|ID документа|
|primary_url|Ссылка на страницу|
|notes|Примечания|
|Дата|Дата сбора данных|

## ⚙️ Технические детали

- **Puppeteer** — управление безголовым Chrome
- **Задержки:** 3 сек после загрузки страницы, 2 сек между запросами
- **CSV** — UTF-8 с BOM для корректного отображения кириллицы
- **Данные** — не модифицируются, извлекаются как текст

======\
Вижу две проблемы:

1. **Ошибка прав доступа** (EPERM) - старая установка повреждена
2. **Puppeteer пытается скачать `chrome-headless-shell`** (не обычный Chrome)

## Решение: чистая установка с ручным указанием пути

### Шаг 1: Полностью удалите старую установку

Закройте все программы (VS Code, терминалы) и выполните в PowerShell **от имени администратора**:

```powershell
cd C:\
rm -r -force C:\puppeteer-project
```

### Шаг 2: Создайте проект заново

```powershell
mkdir C:\puppeteer-project
cd C:\puppeteer-project
npm init -y
```

### Шаг 3: Установите Puppeteer, полностью пропуская загрузку браузеров

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD="true"
npm install puppeteer
```

### Шаг 4: Распакуйте скачанный файл в правильное место

Вы скачали `chrome-headless-shell-win64.zip` - это специальная версия без графического интерфейса. Распакуйте её:

1. **Создайте папку:**

   ```
   C:\Users\An\.cache\puppeteer\chrome-headless-shell\win64-148.0.7778.97\
   ```

2. **Распакуйте архив** в эту папку так, чтобы `chrome-headless-shell.exe` лежал по пути:

   ```
   C:\Users\An\.cache\puppeteer\chrome-headless-shell\win64-148.0.7778.97\chrome-headless-shell.exe
   ```

### Шаг 5: Создайте тестовый скрипт

Создайте файл `test.js` в папке `C:\puppeteer-project`:

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Users\\An\\.cache\\puppeteer\\chrome-headless-shell\\win64-148.0.7778.97\\chrome-headless-shell.exe'
  });
  
  const page = await browser.newPage();
  await page.goto('https://example.com');
  console.log('Заголовок страницы:', await page.title());
  
  await browser.close();
  console.log('Успех!');
})();
```

### Шаг 6: Запустите

```powershell
node test.js
```

## Альтернатива: используйте обычный Chrome

Если хотите использовать обычный Chrome (с графическим интерфейсом), скачайте:

- `chrome-win64.zip` (НЕ `chrome-headless-shell-win64.zip`)

Распакуйте в:

```
C:\Users\An\.cache\puppeteer\chrome\win64-148.0.7778.97\chrome.exe
```

И в коде укажите:

```javascript
executablePath: 'C:\\Users\\An\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome.exe'
```

## Что пошло не так?

1. `set` vs `$env:` - в PowerShell нужно использовать `$env:`, а не `set`
2. Установщик пытался удалить старые файлы, но не хватило прав
3. Puppeteer нужен `chrome-headless-shell`, если вы не указали иное

**Важно:** Убедитесь, что версия в пути совпадает с той, что требует Puppeteer (`148.0.7778.97`).

======\
// Запустите в консоли браузера (F12) на странице карточки персоны OBD Memorial  

```
// Запустите в консоли браузера (F12) на странице карточки персоны OBD Memorial

(function() {
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
    const data = {
        // Основные поля
        last_name: getParamValue('Фамилия'),
        first_name: getParamValue('Имя'),
        middle_name: getParamValue('Отчество'),
        date_birth: getParamValue('Дата рождения'),
        place_birth: getParamValue('Место рождения'),
        date_death: getParamValue('Дата выбытия'),
        rank: getParamValue('Воинское звание'),
        warunit: getParamValue('Последнее место службы'),
        cause_of_death: getParamValue('Причина выбытия'),
        primary_burial: getParamValue('Первичное место захоронения'),
        
        // Архивные данные
        nomer_fonda: getParamValue('Номер фонда источника информации'),
        nomer_opisi: getParamValue('Номер описи источника информации'),
        nomer_dela: getParamValue('Номер дела источника информации'),
        document_type: getParamValue('Название источника донесения'),
        
        // Служебные поля
        document_id: '',
        current_burial: getParamValue('Место захоронения'),
        conscription_location: getParamValue('Место призыва'),
        primary_url: window.location.href,
        notes: '',
        data: new Date().toISOString().split('T')[0],
        
        // Заголовок
        заголовок: `${getParamValue('Фамилия')} ${getParamValue('Имя')} ${getParamValue('Отчество')}`.trim()
    };

    // Получение document_id из URL или id_common
    const idCommon = document.querySelector('[id_common]')?.getAttribute('id_common');
    if (idCommon) data.document_id = idCommon;
    else {
        const urlMatch = window.location.href.match(/id=(\d+)/);
        if (urlMatch) data.document_id = urlMatch[1];
    }

    // Формирование CSV
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
        let value = data[header.toLowerCase()] || '';
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
    });

    const csvContent = [headers.join(','), row.join(',')].join('\n');
    
    // Скачивание файла
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', `person_${data.document_id || Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('✅ CSV скачан');
    console.table(data);
})();
```