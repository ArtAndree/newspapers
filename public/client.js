const form = document.querySelector('#news-form');
if (form) {
  const count = document.querySelector('#count');
  const select = document.querySelector('#category');
  const status = document.querySelector('#category-status');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = Number(count.value);
    if (!/^[1-9]\d*$/.test(count.value) || !Number.isSafeInteger(value)) {
      count.setCustomValidity('Введите целое положительное число.'); count.reportValidity(); return;
    }
    location.assign(`/${value}/news/for/${encodeURIComponent(select.value)}`);
  });
  count.addEventListener('input', () => count.setCustomValidity(''));
  select.addEventListener('change', () => form.requestSubmit());
  (async () => {
    try {
      const response = await fetch('/api/categories', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.categories) || !data.categories.length) throw new Error();
      const previous = select.value;
      select.replaceChildren(...data.categories.map(c => new Option(c.name, c.id, false, c.id === previous)));
      status.textContent = data.warning || 'Категории обновлены с сайта Ведомостей.';
    } catch { status.textContent = 'Не удалось обновить категории. Доступен резервный список.'; }
  })();
}

