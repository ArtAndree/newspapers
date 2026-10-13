import { load } from 'cheerio';

export const RSS_PAGE = 'https://www.vedomosti.ru/info/rss';
export const defaults = [
  { id: 'business', name: 'Бизнес', slug: 'business' },
  { id: 'economic', name: 'Экономика', slug: 'economics' },
  { id: 'finances', name: 'Финансы', slug: 'finance' },
  { id: 'politics', name: 'Политика', slug: 'politics' }
].map(c => ({ ...c, rssUrl: `https://www.vedomosti.ru/rss/rubric/${c.slug}` }));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function parseCategories(html) {
  const $ = load(html);
  const found = new Map();
  $('a[href]').each((_, anchor) => {
    let url;
    try { url = new URL($(anchor).attr('href'), RSS_PAGE); } catch { return; }
    if (url.origin !== 'https://www.vedomosti.ru') return;
    const match = url.pathname.match(/^\/rss\/rubric\/([a-z_]+)(?:\.xml)?\/?$/);
    if (!match) return;
    const item = defaults.find(c => c.slug === match[1]);
    if (item) {
      const name = $(anchor).closest('p').find('strong').first().text().trim() || item.name;
      // rss2json корректно обрабатывает опубликованный текстовый URL без .xml.
      found.set(item.id, { ...item, name, rssUrl: url.origin + url.pathname.replace(/\/$/, '').replace(/\.xml$/, '') });
    }
  });
  return defaults.filter(c => found.has(c.id)).map(c => found.get(c.id));
}

export function createServices({ fetchImpl = fetch, apiKey = process.env.RSS2JSON_API_KEY || '', timeoutMs = 12000 } = {}) {
  let cachedCategories;
  let categoriesUntil = 0;
  let categoriesPending;
  const newsCache = new Map();
  async function request(url, json = false) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'VedomostiNewsStudent/1.0', Accept: json ? 'application/json' : 'text/html' } });
      if (!response.ok) throw new HttpError(502, `Источник вернул HTTP ${response.status}. Попробуйте позже.`);
      return json ? await response.json() : await response.text();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (['TimeoutError', 'AbortError'].includes(error.name)) throw new HttpError(504, 'Источник не ответил вовремя. Попробуйте ещё раз.');
      throw new HttpError(502, 'Не удалось получить данные от источника. Проверьте интернет и повторите запрос.');
    }
  }
  async function categories() {
    if (cachedCategories && Date.now() < categoriesUntil) return cachedCategories;
    if (categoriesPending) return categoriesPending;
    categoriesPending = (async () => {
      try {
        const parsed = parseCategories(await request(RSS_PAGE));
        if (parsed.length !== defaults.length) throw new Error('Список RSS изменился');
        cachedCategories = { categories: parsed, source: 'live', warning: null };
        categoriesUntil = Date.now() + 15 * 60 * 1000;
      } catch {
        cachedCategories = { categories: cachedCategories?.categories || defaults, source: 'fallback', warning: 'Сайт Ведомостей временно недоступен или изменил список RSS. Используется сохранённый список категорий.' };
        categoriesUntil = Date.now() + 60 * 1000;
      }
      return cachedCategories;
    })();
    try { return await categoriesPending; } finally { categoriesPending = null; }
  }
  async function news(category, count) {
    const cacheKey = `${category.id}:${count}`;
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() < cached.until) return cached.items;
    const url = new URL('https://api.rss2json.com/v1/api.json');
    url.searchParams.set('rss_url', category.rssUrl);
    if (apiKey) {
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('count', String(count));
    }
    const data = await request(url, true);
    if (data?.status !== 'ok' || !Array.isArray(data.items)) throw new HttpError(502, 'rss2json не смог обработать RSS. Повторите запрос позже или проверьте API-ключ.');
    const items = data.items.filter(x => x && typeof x === 'object').map(item => {
      const $ = load(String(item.description || item.content || ''));
      $('script,style,iframe').remove();
      let link = null;
      try { const u = new URL(item.link); if (['https:', 'http:'].includes(u.protocol)) link = u.href; } catch {}
      return { title: String(item.title || 'Без заголовка'), description: $.text().replace(/\s+/g, ' ').trim(), link, date: String(item.pubDate || '') };
    }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, count);
    if (newsCache.size >= 100) newsCache.delete(newsCache.keys().next().value);
    newsCache.set(cacheKey, { items, until: Date.now() + 60000 });
    return items;
  }
  return { categories, news };
}
