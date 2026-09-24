# Сбор объектов «Захоронения ВОВ» с obd-memorial.ru

> Репозиторий: `ermek-toptaev-1/puppeteer-project`
> Дата: 2026-10
> Назначение: собрать `primary_url` захоронений со страницы поиска и составить `*.csv` с объектами «Захоронения ВОВ» (карточки «Информация о захоронении»).

---

## 1. Общая схема (2 шага)

```
Шаг 1 (в браузере, F12)
  Страница поиска obd-memorial.ru → F12 → Console → вставить код сборщика
  → скачивается CSV: primary_url (по одной ссылке на строку)
        https://obd-memorial.ru/html/info.htm?id=1167839469
        ...

Шаг 2 (в терминале, Node.js + Edge CDP)
  node obd-edge-objects.js objects.txt
  → создаётся obyekty_zahoroneniya_VOV.csv
```

---

## 2. Шаг 1 — сбор `primary_url` (F12-сборщик)

### Как использовать
1. Откройте страницу поиска obd-memorial.ru с нужными фильтрами (например, регион «Республика Крым», тип «Захоронение»).
2. Нажмите `F12` → вкладка **Console**.
3. Вставьте код ниже и нажмите `Enter`.
4. Браузер скачает CSV-файл вида `obd_burial_primary_urls_<дата>.csv` с колонкой `primary_url`.

### Важно про пагинацию
Страница поиска obd-memorial.ru при переходе между страницами **перезагружается** (`window.location.href`). Поэтому сборщик **не кликает по кнопке «›»**, а ходит по страницам через `fetch()` с параметром `&p=`.

### Код (копипаста в Console)

```javascript
/**
 * ============================================================
 * OBD Memorial — сбор ВСЕХ primary_url «Захоронения» со страницы поиска
 * Запуск: открыть страницу поиска → F12 → Console → вставить → Enter
 * ============================================================
 */
(async function collectBurialPrimaryUrls() {
    // ---------- Настройки ----------
    const MAX_PAGES = 200;               // защита от бесконечного цикла
    const DELAY_MS  = 2500;              // пауза между запросами страниц
    const BASE      = 'https://obd-memorial.ru';
    const URL_PARAM = '&ps=100';         // сколько результатов на странице (10/20/50/100)

    const all = [];                      // все primary_url
    const seen = new Set();              // защита от дублей внутри прогона

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Текущий URL страницы поиска (без якоря)
    let baseUrl = location.href.split('#')[0];

    // Если в URL ещё нет &p= — добавим &p=1
    if (!baseUrl.includes('&p=') && !baseUrl.includes('?p=')) {
        baseUrl += (baseUrl.includes('?') ? '&' : '?') + 'p=1';
    }

    // Парсим HTML-ответ: берём id каждого .search-result (это id захоронения)
    function parseIds(html) {
        const ids = [];
        const re = /<div\s+id="(\d+)"\s+class="row search-result"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            ids.push(m[1]);
        }
        return ids;
    }

    // Пытаемся узнать общее число страниц из текста «из N»
    // (в HTML он выглядит как «из 59» внутри .search-navigation_text2)
    function parseTotalPages(html) {
        const m = html.match(/из\s+(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    }

    let page = 1;
    let totalPages = null;

    while (page <= MAX_PAGES) {
        // Строим URL страницы: заменяем &p=NN на нужный номер
        const pageUrl = baseUrl.replace(/([?&]p=)\d+/, `$1${page}`) + URL_PARAM;
        console.log(`📄 Страница ${page}: ${pageUrl}`);

        let html = '';
        try {
            const resp = await fetch(pageUrl, { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            html = await resp.text();
        } catch (e) {
            console.error(`   ❌ Ошибка загрузки: ${e.message}`);
            break;
        }

        const ids = parseIds(html);
        console.log(`   найдено id: ${ids.length}`);

        if (ids.length === 0) {
            console.log('🏁 Пустая страница — конец.');
            break;
        }

        for (const id of ids) {
            if (!seen.has(id)) {
                seen.add(id);
                all.push(`${BASE}/html/info.htm?id=${id}`);
            }
        }

        // Определяем общее число страниц один раз (из первого ответа)
        if (totalPages === null) {
            totalPages = parseTotalPages(html);
            if (totalPages) console.log(`   всего страниц по данным страницы: ${totalPages}`);
        }

        // Если дошли до последней известной страницы — стоп
        if (totalPages && page >= totalPages) {
            console.log(`🏁 Достигнута последняя страница (${totalPages}).`);
            break;
        }

        await sleep(DELAY_MS);
        page++;
    }

    console.log(`✅ Всего собрано primary_url: ${all.length}`);

    // ---------- CSV ----------
    const esc = v => {
        v = (v ?? '').toString();
        return (v.includes(',') || v.includes('"')) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const csv = ['primary_url', ...all.map(esc)].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `obd_burial_primary_urls_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);

    console.log('💾 CSV сохранён');
})();
```

### Примечания к настройкам
- `MAX_PAGES = 200` — ограничение; если выборка больше 200 страниц, увеличьте.
- `DELAY_MS = 2500` — пауза между запросами; при большом объёме можно поднять до `3000–4000`.
- `URL_PARAM = '&ps=100'` — можно поставить `10`, `20`, `50` или `100`.
- Скрипт берёт id у элементов `<div class="row search-result">` — это корректно для карточек «Захоронение».

---

## 3. Шаг 2 — парсер карточек объектов (файл `obd-edge-objects.js`)

Файл лежит в **корне репозитория**: `obd-edge-objects.js`.

### Запуск
```bash
# 1. Запустить Edge с remote-debugging (отдельный процесс):
pwsh scripts/RunEdgeOBD.ps1        # порт 9226

# 2. Запустить парсер (в другом терминале):
node obd-edge-objects.js objects.txt
node obd-edge-objects.js objects.txt --dry-run   # ничего не писать
node obd-edge-objects.js objects.txt --port=9227 # другой порт
```

### Вход
`objects.txt` — список `primary_url` (по одной на строку), например:
```
https://obd-memorial.ru/html/info.htm?id=1167839469
https://obd-memorial.ru/html/info.htm?id=33123695
```

### Выход
| Файл | Описание |
|---|---|
| `obyekty_zahoroneniya_VOV.csv` | итоговый CSV (UTF-8 с BOM) |
| `obyekty_zahoroneniya_VOV.session.log` | лог прогона |
| `obyekty_zahoroneniya_VOV.errors.log` | только ошибки |

### Колонки CSV
```
document_id, primary_url, country_burial, region_burial, vmc_number,
current_burial, date_created, date_last_burial, burial_type, burial_state,
graves_count, buried_total, buried_known, buried_unknown, sponsor, rebural_from
```

Соответствие полям карточки «Информация о захоронении»:

| Колонка CSV | Поле на сайте |
|---|---|
| `country_burial` | Страна захоронения |
| `region_burial` | Регион захоронения |
| `vmc_number` | Номер захоронения в ВМЦ |
| `current_burial` | Место захоронения |
| `date_created` | Дата создания современного места захоронения |
| `date_last_burial` | Дата последнего захоронения |
| `burial_type` | Вид захоронения |
| `burial_state` | Состояние захоронения |
| `graves_count` | Количество могил |
| `buried_total` | Захоронено всего |
| `buried_known` | Захоронено известных |
| `buried_unknown` | Захоронено неизвестных |
| `sponsor` | Кто шефствует над захоронением |
| `rebural_from` | Откуда производились перезахоронения |
| `document_id` | id из URL (`id=...`) |
| `primary_url` | Полный URL карточки |

### Особенности
- Операция **разовая**: контроль дублей и журнал обработанных URL не ведутся.
- «Тормоз»/notes **не используется**: объекты пишутся как есть.
- Скрипт не парсит персоны и не определяет тип файла.

---

## 4. Пример «одиночного запроса»

Если нужно собрать **одно** захоронение по ID:

1. Возьмите ID, например `1167839469`.
2. Составьте URL:
   ```
   https://obd-memorial.ru/html/info.htm?id=1167839469
   ```
3. Положите его в `objects.txt` (одной строкой).
4. Выполните:
   ```bash
   node obd-edge-objects.js objects.txt
   ```
5. В `obyekty_zahoroneniya_VOV.csv` появится одна строка с данными этого захоронения.

---

## 5. Файлы, созданные по этой задаче

| Файл | Назначение |
|---|---|
| `obd-edge-objects.js` | парсер карточек «Информация о захоронении» → CSV |
| `scripts/collect-burial-urls.js` | F12-сборщик `primary_url` со страницы поиска |
| `docs/this-file.md` | пояснение + копипаста |

---

## 6. TODO / возможные доработки (по запросу)

- [ ] Проверить фактические названия полей на реальной карточке объекта (если появятся новые поля — дополнить схему).
- [ ] Если понадобится — добавить фильтр «только захоронения» по иконке `title="Захоронение"` в сборщике.
- [ ] Если понадобится — разбивать большой список URL на пакеты (batch) для длительных прогонов.