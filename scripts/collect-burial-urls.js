/**
 * ============================================================
 * OBD Memorial — сбор ВСЕХ primary_url «Захоронения» со страницы поиска
 * Запуск: открыть страницу поиска (например, Крым) → F12 → Console →
 *         вставить код → Enter
 *
 * ВАЖНО: страница поиска obd-memorial.ru использует ПЕРЕЗАГРУЗКУ
 * (window.location.href) при переходе по страницам пагинации,
 * поэтому здесь НЕ используется клик по кнопке «›».
 * Сбор идёт через fetch() с параметром &p= (номер страницы).
 *
 * По умолчанию собирает все страницы, пока не упрётся в конец.
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