import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServices, defaults, HttpError } from './src/services.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp(services = createServices()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.use((req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(path.join(root, 'public')));
  app.get('/', (req, res) => res.render('index', { title: 'Лента Ведомостей', categories: defaults, count: 10, selected: 'business' }));
  app.get('/api/categories', async (req, res) => res.json(await services.categories()));
  app.get('/:count/news/for/:category', async (req, res) => {
    const { count: raw, category: id } = req.params;
    const count = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(count)) throw new HttpError(400, 'Количество должно быть целым положительным числом, например 10.');
    if (!defaults.some(c => c.id === id)) throw new HttpError(400, 'Допустимые категории: business, economic, finances, politics.');
    const result = await services.categories();
    const category = result.categories.find(c => c.id === id);
    const items = await services.news(category, count);
    res.render('news', { title: `${category.name} — Ведомости`, categories: result.categories, count, selected: id, category, items, warning: result.warning });
  });
  app.use((req, res, next) => next(new HttpError(404, 'Страница не найдена. Вернитесь на главную и выберите новости.')));
  app.use((error, req, res, next) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('Внутренняя ошибка:', error.message);
    const message = status === 500 ? 'Внутренняя ошибка сервера. Попробуйте позже.' : error.message;
    if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
    res.status(status).render('error', { title: `Ошибка ${status}`, status, message });
  });
  return app;
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT');
const server = createApp().listen(port, () => console.log('http://localhost:' + port));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });

