# Отчёт: сбор объектов «Захоронения ВОВ» с obd-memorial.ru

> Репозиторий: `ermek-toptaev-1/puppeteer-project`
> Дата: 2026-10
> Автор: Anna A. (t79781459649) / SourceCraft
> Статус: выполнено, все шаги закоммичены. Локальный прогон скриптов — на стороне пользователя.

---

## Краткая суть задачи

Одиночным запросом собрать `primary_url` объекта захоронения (например, `id=1167839469` → `https://obd-memorial.ru/html/info.htm?id=1167839469`), затем адаптированным файлом `obd-edge-objects.js` составить `*.csv` с объектами «Захоронения ВОВ».

Итоговая связка из двух шагов:
1. **F12-сборщик** (в браузере) собирает `primary_url` со страниц поиска.
2. **`obd-edge-objects.js`** (Node.js + Edge CDP) парсит карточки «Информация о захоронении» в CSV.

---

## ШАГ 1 — парсер объектов `obd-edge-objects.js`

| Параметр | Значение |
|---|---|
| Путь | `obd-edge-objects.js` (корень репозитория) |
| Коммит | `f553937730cd310ba46c954bd0f5d637d84a90ba` |
| Сообщение | `feat: add obd-edge-objects.js parser for WWII burial objects CSV` |

### Что сделано
- Новый парсер карточек «Информация о захоронении» (объекты гос-регистрации).
- Вход: `objects.txt` со списком `primary_url` (позиционный аргумент).
- Выход: `obyekty_zahoroneniya_VOV.csv` (транслитом, UTF-8 с BOM) + `.session.log` + `.errors.log`.
- Схема CSV (16 колонок):
  ```
  document_id, primary_url, country_burial, region_burial, vmc_number,
  current_burial, date_created, date_last_burial, burial_type, burial_state,
  graves_count, buried_total, buried_known, buried_unknown, sponsor, rebural_from
  ```
- Поддержка `--dry-run`, `--port=9226/9227`.
- Операция разовая: контроль дублей и «тормоз»/notes НЕ используются (по решению пользователя).

---

## ШАГ 2 — F12-сборщик `primary_url`

| Параметр | Значение |
|---|---|
| Путь | `scripts/collect-burial-urls.js` |
| Коммит | `12f56eb6e6693443ee4177e8a295b8e706c30396` |
| Сообщение | `feat: add F12 collector for burial primary_url from search pages` |

### Что сделано
- Код ��ля вставки в **Console** (F12) на странице поиска obd-memorial.ru.
- Адаптирован под реальную страницу (issue #5): сайт при пагинации **перезагружает страницу** (`window.location.href`), поэтому сбор идёт через `fetch()` с параметром `&p=` (без кликов по «›»).
- Берёт `id` у элементов `<div class="row search-result">` и формирует `https://obd-memorial.ru/html/info.htm?id=<id>`.
- Настройки: `MAX_PAGES = 200`, `DELAY_MS = 2500`, `URL_PARAM = '&ps=100'` (можно 10/20/50/100).
- Скачивает CSV `obd_burial_primary_urls_<дата>.csv` с колонкой `primary_url`.
- Защита от дублей внутри прогона; автоопределение последней страницы по «из N».

---

## ШАГ 3 — документация в `docs/`

| Параметр | Значение |
|---|---|
| Путь | `docs/obd-edge-objects.md` |
| Коммит | `6bc22db7401f2d853ef56759702298d7e3b95628` |
| Сообщение | `docs: add obd-edge-objects.md with F12 collector copy-paste and parser usage` |

### Что внутри
- Общая схема (2 шага).
- Копипаста F12-сборщика для Console.
- Инструкция по запуску `obd-edge-objects.js`.
- Вход/выход, соответствие колонок CSV полям карточки.
- Пример «одиночного запроса»: `id=1167839469` → URL → `objects.txt` → CSV.
- TODO (проверка фактических полей карточки, фильтр по иконке «Захоронение», пакетная обработка).

---

## Пример «одиночного запроса»

```
ID:            1167839469
primary_url:   https://obd-memorial.ru/html/info.htm?id=1167839469
```

1. Положить URL в `objects.txt`.
2. Выполнить:
   ```bash
   pwsh scripts/RunEdgeOBD.ps1
   node obd-edge-objects.js objects.txt
   ```
3. Получить `obyekty_zahoroneniya_VOV.csv` с одной строкой.

---

## Итоговые ссылки

- Парсер: https://sourcecraft.dev/ermek-toptaev-1/puppeteer-project/browse/obd-edge-objects.js?rev=main
- Сборщик: https://sourcecraft.dev/ermek-toptaev-1/puppeteer-project/browse/scripts/collect-burial-urls.js?rev=main
- Документ: https://sourcecraft.dev/ermek-toptaev-1/puppeteer-project/browse/docs/obd-edge-objects.md?rev=main

---

## Коммиты (все раздельные)

1. `f5539377` — `obd-edge-objects.js`
2. `12f56eb6` — `scripts/collect-burial-urls.js`
3. `6bc22db7` — `docs/obd-edge-objects.md`
4. `этот коммит` — `reports/report-obd-edge-objects-2026-10.md`

---

## TODO / возможные доработки (по запросу)

- [ ] Проверить фактические названия полей на реальной карточке объекта; дополнить схему при появлении новых полей.
- [ ] При необходимости — фильтр «только захоронения» по иконке `title="Захоронение"` в сборщике.
- [ ] При необходимости — пакетная (batch) обработка длинных списков URL.