import { get, getAll, getMeta, setMeta } from './db.js';
import { getCategory, getCountry } from './countries.js';
import { convert, currencies, currencyOf, formatMoney, formatTwd, itemUnitPrice, itemUnitPriceIn, parseNumber, summarize, taxIncluded } from './money.js';
import { compressPhoto } from './images.js';
import * as model from './model.js';
import * as backup from './backup.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  tab: 'list',
  trip: null,
  trips: [],
  items: [],
  products: new Map(),
  variants: new Map(),
  stores: new Map(),
  thumbs: new Map(),
  q: '',
  status: 'all',
  cat: 'all',
  closedStores: new Set(),
  closedPeople: new Set(),
  displayCurrency: 'local',
  meta: {},
};

const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const PHOTO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>';
const LONG_PRESS_MS = 450;
const DECODE_WAIT_MS = 200;
const SWIPE_PX = 40;

const country = () => getCountry(state.trip.countryCode);
// 統計金額用的幣別（使用者在標題或設定切換），另一種幣別當作「≈」參考。
const displayCode = () => (state.displayCurrency === 'TWD' ? 'TWD' : country().currency);
const otherCode = () => currencies(country()).map((cur) => cur.code).find((code) => code !== displayCode()) ?? null;
const formatIn = (value, code) => formatMoney(value, currencyOf(country(), code));
const money = (value) => formatIn(value, displayCode());
// 把 value 從 fromCode 換成另一種幣別顯示；缺匯率時回傳空字串。
const alsoIn = (value, fromCode = displayCode()) => {
  const code = currencies(country()).map((cur) => cur.code).find((c) => c !== fromCode);
  if (!code || value == null) return '';
  const converted = convert(value, fromCode, code, country(), state.trip.rate);
  return Number.isNaN(converted) ? '' : formatIn(converted, code);
};
const sum = (items, code = displayCode()) => summarize(items, country(), state.trip.rate, code);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const SNOOZE_DAYS = 7;
const RATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function formatDateTime(iso) {
  if (!iso) return '尚未備份';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function variantLabel(variant) {
  if (!variant || variant.amount == null) return '';
  const pack = variant.packCount > 1 ? ` × ${variant.packCount} 入` : '';
  return `${variant.amount}${variant.unit}${pack}`;
}

// ---- 載入資料 ----

async function load() {
  state.trip = await model.ensureInitialData();
  const [trips, items, products, variants, stores, photos] = await Promise.all(
    ['trips', 'items', 'products', 'variants', 'stores', 'photos'].map(getAll),
  );
  state.trips = trips.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.items = items.filter((i) => i.tripId === state.trip.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.products = new Map(products.map((p) => [p.id, p]));
  state.variants = new Map(variants.map((v) => [v.id, v]));
  state.stores = new Map(stores.map((s) => [s.id, s]));

  for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
  state.thumbs = new Map(photos.map((p) => [p.id, URL.createObjectURL(p.thumb)]));

  state.meta = {
    changes: await getMeta('changesSinceBackup', 0),
    photoChanges: await getMeta('photoChangesSinceFull', 0),
    lastBackupAt: await getMeta('lastBackupAt'),
    canUndoImport: Boolean(await getMeta('safetyCopy')),
    backupSnoozed: Date.now() < Date.parse(await getMeta('backupPromptSnoozedUntil', '') || 0),
  };
  state.displayCurrency = await getMeta('displayCurrency', 'local');
}

async function refresh() {
  await load();
  render();
}

// ---- 畫面 ----

function render() {
  renderHeader();
  for (const button of document.querySelectorAll('#tabs button')) {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#add-button').hidden = state.tab === 'settings' || state.tab === 'spend';
  const views = { list: renderList, stores: renderStores, people: renderPeople, spend: renderSpend, settings: renderSettings };
  views[state.tab]();
}

function renderHeader() {
  const s = sum(state.items);
  const converted = alsoIn(s.total);
  const other = otherCode();
  $('#top').innerHTML = `
    <div class="top-row">
      <button type="button" class="trip-name" data-action="tab" data-tab="settings">${esc(state.trip.name)}</button>
      <span class="progress">已買 <b>${s.doneCount}</b>/${s.count}</span>
    </div>
    <div class="top-total">
      <span class="top-label">預估總額</span>
      <span class="top-amount">${money(s.total)}</span>
      ${converted ? `<span class="top-twd">≈ ${converted}</span>` : ''}
      ${s.unconverted ? `<span class="top-twd">（${s.unconverted} 樣缺匯率未計入）</span>` : ''}
      ${other ? `<button type="button" class="cur-switch" data-action="toggle-currency" aria-label="統計金額改用 ${esc(currencyOf(country(), other).code)} 顯示">改看 ${esc(currencyOf(country(), other).symbol)}</button>` : ''}
    </div>`;
}

function hasUnsavedBackup() {
  return state.meta.changes > 0 || state.meta.photoChanges > 0;
}

function backupBanner() {
  if (!hasUnsavedBackup() || state.items.length === 0 || state.meta.backupSnoozed) return '';
  return `<button type="button" class="notice" data-action="backup-prompt">
    <span><b>有變更尚未備份</b>${state.meta.lastBackupAt ? `　上次：${esc(formatDateTime(state.meta.lastBackupAt))}` : ''}</span><span class="notice-go">備份</span>
  </button>`;
}

function installBanner() {
  if (isStandalone()) return '';
  return `<button type="button" class="notice notice-info" data-action="install-help">
    <span><b>加到主畫面</b>　全螢幕使用，也能離線開啟</span><span class="notice-go">怎麼做</span>
  </button>`;
}

// number 是清單分頁的順序編號，其他分頁不傳就不顯示。
function itemRow(item, number = null) {
  const product = state.products.get(item.productId);
  const variant = state.variants.get(item.variantId);
  const storeName = state.stores.get(item.storeId)?.name;
  const unit = itemUnitPrice(item, country());
  const meta = [`× ${item.qty}`, variantLabel(variant), storeName, item.forWhom && `幫${item.forWhom}買`].filter(Boolean);
  const photoIds = model.photoIdsOf(item).filter((pid) => state.thumbs.has(pid));
  const thumb = photoIds.length ? state.thumbs.get(photoIds[0]) : null;
  return `
    <article class="item ${item.purchased ? 'done' : ''} ${number ? 'numbered' : ''}">
      ${number ? `<span class="item-no" aria-label="第 ${number} 樣">${number}</span>` : ''}
      <button type="button" class="check" data-action="toggle" data-id="${esc(item.id)}"
        aria-pressed="${item.purchased}" aria-label="${item.purchased ? '改成未買' : '標記已買'}：${esc(product?.name)}">${CHECK_ICON}</button>
      ${thumb
        ? `<button type="button" class="thumb-btn zoomable" data-action="photo" data-item="${esc(item.id)}" data-index="0" aria-label="看大圖：${esc(product?.name)}"><img class="thumb" src="${thumb}" alt=""></button>`
        : `<button type="button" class="thumb-btn" data-action="edit-item" data-id="${esc(item.id)}" aria-label="編輯：${esc(product?.name)}"><span class="thumb thumb-empty">${PHOTO_ICON}</span></button>`}
      <button type="button" class="item-main" data-action="edit-item" data-id="${esc(item.id)}">
        <span class="item-text">
          <span class="item-name">${esc(product?.name)}</span>
          ${product?.foreignName ? `<span class="item-foreign" lang="ja">${esc(product.foreignName)}</span>` : ''}
          <span class="item-meta">${esc(meta.join(' · '))}</span>
        </span>
        <span class="price-tag ${unit == null ? 'empty' : ''} ${item.actualPrice != null ? 'actual' : ''}">
          ${unit == null ? '未填價' : formatMoney(unit.value, unit.currency)}
        </span>
      </button>
      ${item.purchased ? `<button type="button" class="item-delete" data-action="delete-item" data-id="${esc(item.id)}" aria-label="刪除：${esc(product?.name)}">${TRASH_ICON}</button>` : ''}
    </article>`;
}

function checkedBar() {
  const count = state.items.filter((i) => i.purchased).length;
  if (!count) return '';
  return `<div class="selection-bar">
    <span>已勾選 <b>${count}</b> 樣</span>
    <button type="button" class="btn btn-small btn-danger" data-action="delete-checked">刪除已勾選</button>
  </div>`;
}

function emptyList() {
  return `<div class="empty-state">
    <h2>清單還是空的</h2>
    <p>按右下角的＋加入第一樣商品，只填名稱也可以。</p>
    <button type="button" class="btn" data-action="add-samples">先放範例看看</button>
  </div>`;
}

function renderList() {
  const hasSamples = state.items.some((i) => i.sample);
  const c = country();
  // 分類裡的品項都刪光時，回到全部，免得畫面只剩「找不到」。
  if (state.cat !== 'all' && !state.items.some((i) => state.products.get(i.productId)?.categoryId === state.cat)) state.cat = 'all';
  $('#view').innerHTML = `
    ${installBanner()}
    ${backupBanner()}
    ${hasSamples ? '<button type="button" class="notice notice-info" data-action="clear-samples"><span>目前有範例資料，金額是虛構的</span><span class="notice-go">清除範例</span></button>' : ''}
    <div class="filters">
      <label class="search"><span class="sr-only">搜尋品項</span>
        <input id="search" type="search" placeholder="搜尋品名、日文、店家" value="${esc(state.q)}" autocomplete="off">
      </label>
      <div class="chips" role="group" aria-label="篩選">
        ${[['all', '全部'], ['todo', '未買'], ['done', '已買']]
          .map(([id, name]) => `<button type="button" class="chip ${state.status === id ? 'on' : ''}" data-action="status" data-value="${id}" aria-pressed="${state.status === id}">${name}</button>`)
          .join('')}
        <span class="chip-gap"></span>
        ${c.categories
          .filter((cat) => state.items.some((i) => state.products.get(i.productId)?.categoryId === cat.id))
          .map((cat) => `<button type="button" class="chip ${state.cat === cat.id ? 'on' : ''}" data-action="cat" data-value="${cat.id}" aria-pressed="${state.cat === cat.id}">${esc(cat.name)}</button>`)
          .join('')}
      </div>
    </div>
    <div id="list-body"></div>`;
  $('#search').addEventListener('input', (event) => {
    state.q = event.target.value;
    renderListBody();
  });
  renderListBody();
}

function renderListBody() {
  const body = $('#list-body');
  if (!body) return;
  if (state.items.length === 0) {
    body.innerHTML = emptyList();
    return;
  }
  const c = country();
  const q = state.q.trim().toLowerCase();
  const visible = state.items.filter((item) => {
    const product = state.products.get(item.productId);
    if (state.status === 'todo' && item.purchased) return false;
    if (state.status === 'done' && !item.purchased) return false;
    if (state.cat !== 'all' && product?.categoryId !== state.cat) return false;
    if (!q) return true;
    const text = [product?.name, product?.foreignName, state.stores.get(item.storeId)?.name, item.forWhom, item.note].join(' ').toLowerCase();
    return text.includes(q);
  });
  if (visible.length === 0) {
    body.innerHTML = '<div class="empty-state"><h2>找不到符合的品項</h2><p>試試其他關鍵字，或調整上方的篩選。</p></div>';
    return;
  }
  // 統計：件數、已買／未買、預估金額（用目前的顯示幣別）。
  const stats = (items) => {
    const s = sum(items);
    const parts = [`${s.count} 樣`, `已買 ${s.doneCount}`, `未買 ${s.count - s.doneCount}`];
    if (s.total > 0) parts.push(`約 ${money(s.total)}`);
    return parts.join(' · ');
  };
  let number = 0;
  const groups = c.categories
    .map((cat) => {
      const rows = visible.filter((i) => getCategory(c, state.products.get(i.productId)?.categoryId).id === cat.id);
      if (!rows.length) return '';
      return `<section class="group">
        <h2 class="group-title">${esc(cat.name)}<span class="group-stats">${esc(stats(rows))}</span></h2>
        ${rows.map((item) => itemRow(item, ++number)).join('')}
      </section>`;
    })
    .join('');
  body.innerHTML = `${checkedBar()}<p class="list-stats">${visible.length < state.items.length ? '篩選結果' : '全部'}：${esc(stats(visible))}</p>${groups}`;
}

// 店家、幫誰買兩個分頁共用：依 keyOf 分組，沒填的那組排最後，可個別收合。
function renderGrouped({ keyOf, nameOf, closed, empty }) {
  if (state.items.length === 0) {
    $('#view').innerHTML = empty;
    return;
  }
  const groups = new Map();
  for (const item of state.items) {
    const key = keyOf(item) || 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === 'none') - (b === 'none'));
  $('#view').innerHTML = checkedBar() + ordered
    .map(([key, items]) => {
      const s = sum(items);
      const left = s.count - s.doneCount;
      return `<details class="store" data-group="${esc(key)}" ${closed.has(key) ? '' : 'open'}>
        <summary>
          <span class="store-name">${esc(nameOf(key))}</span>
          <span class="store-sub">${left ? `還有 ${left} 樣 · 約 ${money(s.remaining)}` : '都買齊了'}</span>
        </summary>
        ${items.map((item) => itemRow(item)).join('')}
      </details>`;
    })
    .join('');
  for (const details of document.querySelectorAll('.store')) {
    details.addEventListener('toggle', () => {
      if (details.open) closed.delete(details.dataset.group);
      else closed.add(details.dataset.group);
    });
  }
}

function renderStores() {
  renderGrouped({
    keyOf: (item) => item.storeId,
    nameOf: (key) => (key === 'none' ? '未指定店家' : state.stores.get(key)?.name),
    closed: state.closedStores,
    empty: '<div class="empty-state"><h2>還沒有店家</h2><p>新增品項時填上店家，這裡就會依店家分組。</p></div>',
  });
}

function renderPeople() {
  renderGrouped({
    keyOf: (item) => item.forWhom?.trim(),
    nameOf: (key) => (key === 'none' ? '自己' : key),
    closed: state.closedPeople,
    empty: '<div class="empty-state"><h2>清單還是空的</h2><p>新增品項時填上「幫誰買」，這裡就會依人分組。</p></div>',
  });
}

function breakdownRows(entries, total) {
  return entries
    .sort((a, b) => b.amount - a.amount)
    .map(({ name, amount }) => {
      const share = total > 0 ? Math.round((amount / total) * 100) : 0;
      return `<div class="bar-row">
        <div class="bar-label"><span>${esc(name)}</span><span class="num">${money(amount)}</span></div>
        <div class="bar"><span style="width:${share}%"></span></div>
      </div>`;
    })
    .join('');
}

function groupAmounts(keyOf) {
  const totals = new Map();
  for (const item of state.items) {
    const name = keyOf(item);
    const unit = itemUnitPriceIn(item, country(), state.trip.rate, displayCode());
    const amount = unit == null || Number.isNaN(unit) ? 0 : unit * item.qty;
    totals.set(name, (totals.get(name) || 0) + amount);
  }
  return [...totals.entries()].map(([name, amount]) => ({ name, amount }));
}

function renderSpend() {
  const c = country();
  const s = sum(state.items);
  const budget = state.trip.budgetTwd;
  const inTwd = sum(state.items, 'TWD');
  const spentTwd = inTwd.spent;
  const totalTwd = inTwd.total;
  let budgetBlock = '';
  if (budget && !inTwd.unconverted) {
    const spentShare = Math.min(100, Math.round((spentTwd / budget) * 100));
    const plannedShare = Math.min(100 - spentShare, Math.round(((totalTwd - spentTwd) / budget) * 100));
    const over = totalTwd > budget;
    budgetBlock = `<section class="panel">
      <h2 class="panel-title">預算 ${formatTwd(budget)}</h2>
      <div class="budget-bar" role="img" aria-label="已花 ${spentShare}%，全部買完佔預算 ${spentShare + plannedShare}%">
        <span class="spent" style="width:${spentShare}%"></span><span class="planned" style="width:${plannedShare}%"></span>
      </div>
      <p class="${over ? 'text-warn' : 'muted'}">${over ? `全部買完會超出 ${formatTwd(totalTwd - budget)}` : `全部買完還剩 ${formatTwd(budget - totalTwd)}`}</p>
    </section>`;
  } else if (budget) {
    budgetBlock = '<section class="panel"><p class="muted">要比較預算，請先到設定填匯率。</p></section>';
  }
  const stat = (label, value) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${money(value)}</span>${alsoIn(value) ? `<span class="stat-twd">≈ ${alsoIn(value)}</span>` : ''}</div>`;
  const byCategory = groupAmounts((i) => getCategory(c, state.products.get(i.productId)?.categoryId).name);
  const byStore = groupAmounts((i) => state.stores.get(i.storeId)?.name || '未指定店家');
  const byPerson = groupAmounts((i) => i.forWhom || '自己');
  $('#view').innerHTML = `
    <section class="stats">${stat('已花', s.spent)}${stat('還要花', s.remaining)}</section>
    ${s.unpriced ? `<p class="muted pad">有 ${s.unpriced} 樣還沒填價格，沒有算進金額。</p>` : ''}
    ${s.unconverted ? `<p class="text-warn pad">有 ${s.unconverted} 樣的幣別需要匯率才能換算，沒有算進金額。請到設定填匯率。</p>` : ''}
    <p class="muted pad">金額都已換算成含稅價並以 ${esc(currencyOf(c, displayCode()).symbol)} 顯示，有實際價時優先用實際價。</p>
    ${budgetBlock}
    ${state.items.length ? `
      <section class="panel"><h2 class="panel-title">依分類</h2>${breakdownRows(byCategory, s.total)}</section>
      <section class="panel"><h2 class="panel-title">依店家</h2>${breakdownRows(byStore, s.total)}</section>
      <section class="panel"><h2 class="panel-title">幫誰買</h2>${breakdownRows(byPerson, s.total)}</section>` : ''}`;
}

async function renderSettings() {
  const t = state.trip;
  const c = country();
  const canDelete = state.trips.length > 1;
  $('#view').innerHTML = `
    <section class="panel">
      <h2 class="panel-title">這趟旅程</h2>
      <label class="field"><span>名稱</span><input id="set-name" data-setting="name" value="${esc(t.name)}" autocomplete="off"></label>
      <div class="field"><span>國家與幣別</span><p class="static">${esc(c.name)}（${esc(c.currency)}）</p></div>
      <label class="field"><span>匯率：1 ${esc(c.currency)} 等於多少台幣</span>
        <input id="set-rate" data-setting="rate" inputmode="decimal" value="${t.rate ?? ''}" placeholder="例如 0.21" autocomplete="off">
      </label>
      <div class="row-between">
        <span class="muted">${t.rateUpdatedAt ? `${t.rateSource === 'manual' ? '手動輸入' : '自動更新'}於 ${esc(formatDateTime(t.rateUpdatedAt))}` : '未設定時無法換算幣別'}</span>
        <button type="button" class="btn btn-small" data-action="update-rate">線上更新</button>
      </div>
      <p class="muted fine">匯率僅供參考。有網路時每 12 小時自動更新；手動輸入後就不再自動更新，按「線上更新」可恢復。資料來源：<a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a></p>
      ${currencies(c).length > 1 ? `<fieldset class="field seg-field"><legend>統計金額顯示幣別</legend>
        <div class="seg">
          ${currencies(c).map((cur) => `<label><input type="radio" name="display-currency" data-setting="displayCurrency" value="${cur.code === 'TWD' ? 'TWD' : 'local'}" ${displayCode() === cur.code ? 'checked' : ''}><span>${esc(cur.symbol)} ${esc(cur.code)}</span></label>`).join('')}
        </div>
      </fieldset>` : ''}
      <label class="field"><span>預算（台幣，可不填）</span>
        <input id="set-budget" data-setting="budget" inputmode="numeric" value="${t.budgetTwd ?? ''}" placeholder="例如 20000" autocomplete="off">
      </label>
    </section>

    <section class="panel">
      <h2 class="panel-title">所有旅程</h2>
      <div class="trip-list">
        ${state.trips.map((trip) => `
          <button type="button" class="trip-row ${trip.id === t.id ? 'current' : ''}" data-action="switch-trip" data-id="${esc(trip.id)}" aria-pressed="${trip.id === t.id}">
            <span>${esc(trip.name)}</span><span class="muted">${trip.id === t.id ? '使用中' : '切換'}</span>
          </button>`).join('')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn" data-action="new-trip">新增旅程</button>
        ${canDelete ? '<button type="button" class="btn" data-action="copy-items">從其他旅程複製</button>' : ''}
        ${canDelete ? '<button type="button" class="btn btn-danger" data-action="delete-trip">刪除這趟</button>' : ''}
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">備份</h2>
      <p class="muted">上次備份：${esc(formatDateTime(state.meta.lastBackupAt))}${hasUnsavedBackup() ? '，之後有變更尚未備份' : ''}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-action="backup-prompt">備份到手機</button>
        <button type="button" class="btn" data-action="import">從備份匯入</button>
        ${state.meta.canUndoImport ? '<button type="button" class="btn" data-action="undo-import">復原上次匯入</button>' : ''}
      </div>
      <p class="muted fine">備份檔存在手機裡，刪除 App 後還能匯入；手機遺失或損壞時就救不回來。</p>
      <p class="muted fine" id="storage-info"></p>
    </section>

    <section class="panel">
      <h2 class="panel-title">主畫面</h2>
      <p class="muted">${isStandalone() ? '目前是從主畫面開啟。刪除主畫面圖示通常會一併刪除資料，刪除前請先備份。' : '目前是從瀏覽器開啟，這裡的資料和主畫面 App 是分開的。'}</p>
      ${isStandalone() ? '' : '<div class="btn-row"><button type="button" class="btn" data-action="install-help">查看安裝步驟</button></div>'}
    </section>`;

  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const info = $('#storage-info');
  if (estimate?.usage != null && info) info.textContent = `這個 App 目前約佔手機 ${backup.formatBytes(estimate.usage)}。`;
}

// ---- 底部面板 ----

function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
  return sheet;
}

function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.open) sheet.close();
  sheet.innerHTML = '';
}

function sheetHeader(title) {
  return `<header class="sheet-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-action="close-sheet" aria-label="關閉">${CLOSE_ICON}</button></header>`;
}

function confirmDialog({ title, body, ok, danger = false }) {
  const dialog = $('#confirm');
  dialog.innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p>
    <div class="btn-row end">
      <button type="button" class="btn" id="confirm-cancel">取消</button>
      <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="confirm-ok">${esc(ok)}</button>
    </div>`;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    $('#confirm-cancel', dialog).onclick = () => finish(false);
    $('#confirm-ok', dialog).onclick = () => finish(true);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}

function showToast(text, action) {
  const toast = $('#toast');
  clearTimeout(showToast.timer);
  toast.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  toast.hidden = false;
  if (action) $('.toast-btn', toast).onclick = action.run;
  else showToast.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

// ---- 品項表單 ----

// 單價欄位：數字加上幣別選單（當地幣或台幣）。
function priceField(key, label, value, code) {
  const c = country();
  const selected = currencyOf(c, code || c.currency).code;
  return `<div class="field">
    <label for="f-${key}">${esc(label)}</label>
    <div class="money-input">
      <input id="f-${key}" inputmode="decimal" value="${value ?? ''}" autocomplete="off">
      <select id="f-${key}-cur" aria-label="${esc(label)}的幣別">
        ${currencies(c).map((cur) => `<option value="${cur.code}" ${cur.code === selected ? 'selected' : ''}>${esc(cur.symbol)}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

async function openItemSheet(id) {
  const c = country();
  const item = id ? await get('items', id) : null;
  const product = item ? state.products.get(item.productId) : null;
  const variant = item ? state.variants.get(item.variantId) : null;
  const category = getCategory(c, product?.categoryId ?? c.categories[0].id);
  const taxMode = item?.taxMode ?? c.defaultTaxMode;
  const taxRate = item?.taxRate ?? category.taxRate;
  const storeNames = new Set([...c.stores, ...[...state.stores.values()].filter((s) => s.countryCode === c.code).map((s) => s.name)]);
  const people = new Set(state.items.map((i) => i.forWhom).filter(Boolean));
  // 表單上的照片，依顯示順序：已存的照片有 id，剛加入的有 draft（壓縮後的大圖與縮圖）。
  const photos = model.photoIdsOf(item)
    .filter((pid) => state.thumbs.has(pid))
    .map((pid) => ({ id: pid, url: state.thumbs.get(pid) }));
  let photosChanged = false;

  const sheet = openSheet(`
    ${sheetHeader(item ? '編輯品項' : '新增品項')}
    <form id="item-form" novalidate>
      <div class="photo-field">
        <div class="photo-strip" id="photo-strip"></div>
        <input id="f-photo" class="sr-only" type="file" accept="image/*" multiple>
        <p class="muted fine" id="photo-status">可拍照或從相簿選，張數不限，存檔前會先壓縮。</p>
      </div>

      <label class="field"><span>名稱（必填）</span><input id="f-name" value="${esc(product?.name)}" autocomplete="off" enterkeyhint="next"></label>
      <p class="field-error" id="name-error" hidden>請填商品名稱。</p>
      <label class="field"><span>日文名稱</span><input id="f-foreign" lang="ja" value="${esc(product?.foreignName)}" autocomplete="off" placeholder="給店員看時會放大顯示"></label>

      <div class="field-grid">
        <label class="field"><span>分類</span><select id="f-cat">${c.categories.map((cat) => `<option value="${cat.id}" ${cat.id === category.id ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}</select></label>
        <label class="field"><span>數量</span><input id="f-qty" inputmode="numeric" value="${item?.qty ?? 1}" autocomplete="off"></label>
      </div>

      <div class="field-grid">
        ${priceField('est', '預估單價', item?.estPrice, item?.estCurrency)}
        ${priceField('actual', '實際單價', item?.actualPrice, item?.actualCurrency)}
      </div>
      <p class="field-error" id="price-error" hidden>金額和數量請填數字。</p>

      <div class="field-grid">
        <fieldset class="field seg-field"><legend>標價</legend>
          <div class="seg">
            <label><input type="radio" name="tax" value="incl" ${taxMode === 'incl' ? 'checked' : ''}><span>含稅</span></label>
            <label><input type="radio" name="tax" value="excl" ${taxMode === 'excl' ? 'checked' : ''}><span>未稅</span></label>
          </div>
        </fieldset>
        <label class="field"><span>稅率</span><select id="f-rate">${c.taxRates.map((r) => `<option value="${r}" ${r === taxRate ? 'selected' : ''}>${r}%</option>`).join('')}</select></label>
      </div>
      <p class="live-price" id="live-price" aria-live="polite"></p>

      <label class="field"><span>店家</span><input id="f-store" list="store-options" value="${esc(state.stores.get(item?.storeId)?.name)}" autocomplete="off"></label>
      <datalist id="store-options">${[...storeNames].map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>

      <div class="field-grid three">
        <label class="field"><span>容量</span><input id="f-amount" inputmode="decimal" value="${variant?.amount ?? ''}" autocomplete="off"></label>
        <label class="field"><span>單位</span><select id="f-unit">${c.units.map((u) => `<option ${variant?.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
        <label class="field"><span>入數</span><input id="f-pack" inputmode="numeric" value="${variant?.packCount ?? 1}" autocomplete="off"></label>
      </div>

      <label class="field"><span>幫誰買</span><input id="f-for" list="people-options" value="${esc(item?.forWhom)}" autocomplete="off"></label>
      <datalist id="people-options">${[...people].map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label class="field"><span>備註</span><textarea id="f-note" rows="2">${esc(item?.note)}</textarea></label>

      <div class="sheet-actions">
        ${item ? `<button type="button" class="btn btn-danger" id="delete-item">刪除</button>
          <button type="button" class="btn" data-action="clerk" data-id="${esc(item.id)}">給店員看</button>` : ''}
        <button type="submit" class="btn btn-primary" id="save-item">儲存</button>
      </div>
    </form>`);

  const updateLivePrice = () => {
    const mode = $('input[name="tax"]:checked', sheet).value;
    const rate = Number($('#f-rate', sheet).value);
    const actual = parseNumber($('#f-actual', sheet).value);
    const est = parseNumber($('#f-est', sheet).value);
    const useActual = actual != null;
    const price = useActual ? actual : est;
    const live = $('#live-price', sheet);
    if (price == null || Number.isNaN(price)) {
      live.textContent = '';
      return;
    }
    const currency = currencyOf(c, $(useActual ? '#f-actual-cur' : '#f-est-cur', sheet).value);
    const withTax = taxIncluded(price, mode, rate, currency.decimals);
    const converted = alsoIn(withTax, currency.code);
    live.textContent = `含稅 ${formatMoney(withTax, currency)}${converted ? ` ≈ ${converted}` : ''}`;
  };
  updateLivePrice();
  $('#item-form', sheet).addEventListener('input', updateLivePrice);
  $('#f-cat', sheet).addEventListener('change', (event) => {
    $('#f-rate', sheet).value = String(getCategory(c, event.target.value).taxRate);
    updateLivePrice();
  });

  const renderPhotos = () => {
    $('#photo-strip', sheet).innerHTML = `
      ${photos.map((p, i) => `<div class="photo-cell">
        <button type="button" class="photo-preview zoomable" data-view="${i}" aria-label="看大圖：第 ${i + 1} 張"><img src="${p.url}" alt=""></button>
        <button type="button" class="photo-remove" data-remove="${i}" aria-label="移除第 ${i + 1} 張照片">${CLOSE_ICON}</button>
      </div>`).join('')}
      <label class="photo-add" for="f-photo">${PHOTO_ICON}<span>${photos.length ? '再加照片' : '加照片'}</span></label>`;
  };
  renderPhotos();

  $('#f-photo', sheet).addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    const status = $('#photo-status', sheet);
    let added = 0;
    let bytes = 0;
    let lastError = null;
    for (const [i, file] of files.entries()) {
      status.textContent = files.length > 1 ? `正在壓縮照片（${i + 1}/${files.length}）…` : '正在壓縮照片…';
      try {
        const draft = await compressPhoto(file);
        photos.push({ draft, url: URL.createObjectURL(draft.thumb) });
        photosChanged = true;
        added += 1;
        bytes += draft.full.size + draft.thumb.size;
        renderPhotos();
      } catch (error) {
        lastError = error.message;
      }
    }
    const parts = [];
    if (added) parts.push(`已加入 ${added} 張，壓縮後約 ${backup.formatBytes(bytes)}，共 ${photos.length} 張。`);
    if (lastError) parts.push(added ? `另有 ${files.length - added} 張無法開啟。` : lastError);
    status.textContent = parts.join('');
  });

  $('#photo-strip', sheet).addEventListener('click', (event) => {
    const viewBtn = event.target.closest('[data-view]');
    if (viewBtn) {
      openPhoto({ sources: photos.map((p) => p.draft?.full ?? p.id), index: Number(viewBtn.dataset.view) });
      return;
    }
    const removeBtn = event.target.closest('[data-remove]');
    if (!removeBtn) return;
    const [removed] = photos.splice(Number(removeBtn.dataset.remove), 1);
    if (removed?.draft) URL.revokeObjectURL(removed.url);
    photosChanged = true;
    renderPhotos();
    $('#photo-status', sheet).textContent = photos.length ? `儲存後會移除這張照片，剩 ${photos.length} 張。` : '儲存後會移除照片。';
  });

  $('#delete-item', sheet)?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '刪除這個品項？', body: `「${product?.name}」和它的照片、價格紀錄都會刪除。`, ok: '刪除', danger: true });
    if (!ok) return;
    await model.deleteItem(item.id);
    closeSheet();
    await refresh();
    showToast('已刪除');
  });

  $('#item-form', sheet).addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#f-name', sheet).value.trim();
    const numbers = {
      qty: parseNumber($('#f-qty', sheet).value),
      estPrice: parseNumber($('#f-est', sheet).value),
      actualPrice: parseNumber($('#f-actual', sheet).value),
      amount: parseNumber($('#f-amount', sheet).value),
      packCount: parseNumber($('#f-pack', sheet).value),
    };
    const badNumber = Object.values(numbers).some(Number.isNaN);
    $('#name-error', sheet).hidden = Boolean(name);
    $('#price-error', sheet).hidden = !badNumber;
    if (!name) {
      $('#f-name', sheet).focus();
      return;
    }
    if (badNumber) return;
    const button = $('#save-item', sheet);
    button.disabled = true;
    try {
      await model.saveItem(
        state.trip,
        {
          id: item?.id,
          name,
          foreignName: $('#f-foreign', sheet).value,
          categoryId: $('#f-cat', sheet).value,
          qty: Math.max(1, Math.round(numbers.qty || 1)),
          estPrice: numbers.estPrice,
          actualPrice: numbers.actualPrice,
          estCurrency: $('#f-est-cur', sheet).value,
          actualCurrency: $('#f-actual-cur', sheet).value,
          amount: numbers.amount,
          unit: $('#f-unit', sheet).value,
          packCount: Math.max(1, Math.round(numbers.packCount || 1)),
          taxMode: $('input[name="tax"]:checked', sheet).value,
          taxRate: Number($('#f-rate', sheet).value),
          storeName: $('#f-store', sheet).value,
          forWhom: $('#f-for', sheet).value,
          note: $('#f-note', sheet).value,
        },
        photosChanged ? photos.map((p) => (p.draft ? { draft: p.draft } : { id: p.id })) : null,
      );
      for (const p of photos) if (p.draft) URL.revokeObjectURL(p.url);
      closeSheet();
      await refresh();
      showToast('已儲存');
    } catch {
      button.disabled = false;
      showToast('儲存失敗，手機空間可能不足。請清出空間後再試一次。');
    }
  });
}

// ---- 看大圖 ----

let openingPhoto = false;

// 盡量等圖片解碼完才顯示，但不讓使用者等太久；圖框大小固定，晚一點出現也不會變形。
async function decodedImage(url) {
  const image = new Image();
  image.className = 'viewer-img';
  image.alt = '商品照片';
  image.draggable = false;
  image.src = url;
  await Promise.race([image.decode().catch(() => {}), new Promise((resolve) => setTimeout(resolve, DECODE_WAIT_MS))]);
  return image;
}

// sources 每一項是照片 id，或表單上還沒存的大圖 Blob；有多張時可左右滑動或按鈕換張。
// 點一下和長按都會走到這裡，長按放開後的點擊不會再開第二次。
async function openPhoto({ sources, index = 0 }) {
  const dialog = $('#photo');
  if (dialog.open || openingPhoto || !sources?.length) return;
  openingPhoto = true;
  const urls = new Map();
  const revokeAll = () => {
    for (const url of urls.values()) if (url) URL.revokeObjectURL(url);
    urls.clear();
  };
  const urlAt = async (i) => {
    if (!urls.has(i)) {
      const source = sources[i];
      const full = source instanceof Blob ? source : (await get('photos', source))?.full;
      urls.set(i, full ? URL.createObjectURL(full) : null);
    }
    return urls.get(i);
  };
  const multi = sources.length > 1;
  let current = Math.min(Math.max(0, index), sources.length - 1);
  let ticket = 0;

  const show = async (i) => {
    const mine = ++ticket;
    const url = await urlAt(i);
    const image = url ? await decodedImage(url) : null;
    if (mine !== ticket) return false;
    current = i;
    const stage = $('.viewer-stage', dialog);
    if (image) stage.replaceChildren(image);
    else stage.innerHTML = '<p class="viewer-missing">找不到這張照片的大圖</p>';
    if (multi) {
      $('#viewer-count', dialog).textContent = `${i + 1} / ${sources.length}`;
      $('#viewer-prev', dialog).disabled = i === 0;
      $('#viewer-next', dialog).disabled = i === sources.length - 1;
    }
    return Boolean(image);
  };
  const go = (step) => {
    const next = current + step;
    if (next >= 0 && next < sources.length) show(next);
  };

  try {
    dialog.innerHTML = `
      <div class="viewer-bar">
        <span class="viewer-count" id="viewer-count" aria-live="polite"></span>
        <button type="button" class="viewer-close" id="viewer-close">關閉</button>
      </div>
      <div class="viewer-stage" tabindex="-1" autofocus></div>
      ${multi ? `<div class="viewer-nav">
        <button type="button" class="viewer-step" id="viewer-prev">上一張</button>
        <button type="button" class="viewer-step" id="viewer-next">下一張</button>
      </div>` : ''}`;
    const found = await show(current);
    if (!found && !multi) {
      revokeAll();
      dialog.innerHTML = '';
      showToast('找不到這張照片的大圖');
      return;
    }
    dialog.onclose = () => {
      if (dialog.open) return;
      ticket += 1;
      revokeAll();
      dialog.innerHTML = '';
      dialog.onkeydown = null;
    };
    dialog.showModal();
    window.getSelection()?.removeAllRanges();
    $('#viewer-close', dialog).onclick = () => dialog.close();
    if (multi) {
      $('#viewer-prev', dialog).onclick = () => go(-1);
      $('#viewer-next', dialog).onclick = () => go(1);
      dialog.onkeydown = (event) => {
        if (event.key === 'ArrowLeft') go(-1);
        if (event.key === 'ArrowRight') go(1);
      };
      const stage = $('.viewer-stage', dialog);
      let startX = null;
      stage.onpointerdown = (event) => { startX = event.clientX; };
      stage.onpointercancel = () => { startX = null; };
      stage.onpointerup = (event) => {
        if (startX == null) return;
        const dx = event.clientX - startX;
        startX = null;
        if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? 1 : -1);
      };
    }
  } finally {
    openingPhoto = false;
  }
}

async function openItemPhotos(itemId, index) {
  const item = await get('items', itemId);
  const ids = model.photoIdsOf(item).filter((pid) => state.thumbs.has(pid));
  await openPhoto({ sources: ids, index });
}

// ---- 給店員看 ----

async function openClerk(id) {
  const item = await get('items', id);
  if (!item) return;
  const product = state.products.get(item.productId);
  const variant = state.variants.get(item.variantId);
  const photoIds = model.photoIdsOf(item).filter((pid) => state.thumbs.has(pid));
  const fulls = await Promise.all(photoIds.map(async (pid) => (await get('photos', pid))?.full));
  const urls = fulls.map((full) => (full ? URL.createObjectURL(full) : null));
  const dialog = $('#clerk');
  const label = variantLabel(variant);
  const phrases = country().clerkPhrases;
  dialog.innerHTML = `
    <button type="button" class="clerk-close" id="clerk-close">關閉</button>
    ${photoIds.length ? `<div class="clerk-photos ${photoIds.length > 1 ? 'multi' : ''}">
      ${photoIds.map((pid, i) => `<button type="button" class="clerk-photo-btn zoomable" data-action="photo" data-item="${esc(item.id)}" data-index="${i}" aria-label="看大圖：第 ${i + 1} 張"><img class="clerk-photo" src="${urls[i] ?? state.thumbs.get(pid)}" alt="${esc(product?.name)}"></button>`).join('')}
    </div>` : ''}
    <div class="clerk-body" lang="ja">
      <p class="clerk-name">${esc(product?.foreignName || product?.name)}</p>
      <p class="clerk-sub">${esc([label, `× ${item.qty}`].filter(Boolean).join('　'))}</p>
      <div class="clerk-phrases">
        ${phrases.map((p) => `<p><b>${esc(p.text)}</b><span lang="zh-Hant-TW">${esc(p.zh)}</span></p>`).join('')}
      </div>
    </div>`;
  dialog.showModal();
  $('#clerk-close', dialog).onclick = () => {
    dialog.close();
    for (const url of urls) if (url) URL.revokeObjectURL(url);
    dialog.innerHTML = '';
  };
}

// ---- 備份與匯入 ----

async function openBackupPrompt() {
  const size = await backup.estimateBackupSize();
  const changes = [];
  if (state.meta.changes > 0) changes.push(`${state.meta.changes} 筆變更`);
  if (state.meta.photoChanges > 0) changes.push(`${state.meta.photoChanges} 張照片`);
  openSheet(`
    ${sheetHeader('備份到手機')}
    <p class="lead">${changes.length ? `有 ${changes.join('、')}還沒備份` : '目前的資料都已備份'}</p>
    <dl class="facts">
      <div><dt>上次備份</dt><dd>${esc(formatDateTime(state.meta.lastBackupAt))}</dd></div>
      <div><dt>完整備份</dt><dd>約 ${backup.formatBytes(size.fullBytes)}（${size.photoCount} 張照片）</dd></div>
      <div><dt>只備份文字</dt><dd>約 ${backup.formatBytes(size.textBytes)}</dd></div>
    </dl>
    <p class="muted">備份檔會存在手機裡，不會上傳。手機遺失或損壞時，這份備份也救不回來。</p>
    <div class="stack">
      <button type="button" class="btn btn-primary" data-action="prepare-backup" data-photos="1">立即備份</button>
      <button type="button" class="btn" data-action="prepare-backup" data-photos="0">只備份文字</button>
      <button type="button" class="btn" data-action="snooze-backup">${SNOOZE_DAYS} 天內不再提醒</button>
      <button type="button" class="btn btn-quiet" data-action="close-sheet">下次再提醒</button>
    </div>`);
}

// iPhone 的分享選單必須由按鈕直接觸發，所以先準備好檔案，再讓使用者按第二次。
async function prepareBackup(includePhotos) {
  openSheet(`${sheetHeader('準備備份檔')}<p class="lead">正在打包資料…</p>`);
  let file;
  try {
    file = await backup.createBackupFile(includePhotos);
  } catch {
    openSheet(`${sheetHeader('備份失敗')}<p>無法打包資料，請關閉 App 重新開啟後再試一次。</p>`);
    return;
  }
  const canShare = Boolean(navigator.canShare?.({ files: [file] }));
  const sheet = openSheet(`
    ${sheetHeader('備份檔已準備好')}
    <dl class="facts">
      <div><dt>檔名</dt><dd class="break">${esc(file.name)}</dd></div>
      <div><dt>大小</dt><dd>${backup.formatBytes(file.size)}</dd></div>
    </dl>
    ${canShare
      ? '<p class="muted">按下後會開啟分享選單，請選「儲存到檔案」，再選「我的 iPhone」裡的資料夾。</p>'
      : '<p class="muted">按下後會下載到手機的「下載」資料夾，刪除前請先確認不再需要。</p>'}
    <div class="stack"><button type="button" class="btn btn-primary" id="send-backup">${canShare ? '存到手機' : '下載備份檔'}</button></div>`);

  $('#send-backup', sheet).addEventListener('click', async () => {
    try {
      if (canShare) {
        await navigator.share({ files: [file], title: file.name });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('沒有成功開啟分享選單，請再按一次。');
      return;
    }
    await backup.markBackedUp(includePhotos);
    closeSheet();
    await refresh();
    const where = canShare ? '請到「檔案」App 確認' : '請到「下載」資料夾確認';
    showToast(includePhotos ? `已備份，${where}` : `文字已備份，照片還沒備份，${where}`);
  });
}

async function handleImportFile(file) {
  let parsed;
  try {
    parsed = backup.parseBackup(await file.text());
  } catch (error) {
    openSheet(`${sheetHeader('無法匯入')}<p>${esc(error.message)}</p><p class="muted">手機上的資料沒有變動。</p>`);
    return;
  }
  const sheet = openSheet(`
    ${sheetHeader('確認匯入')}
    <dl class="facts">
      <div><dt>備份時間</dt><dd>${esc(formatDateTime(parsed.exportedAt))}</dd></div>
      <div><dt>旅程</dt><dd>${parsed.summary.trips} 趟</dd></div>
      <div><dt>品項</dt><dd>${parsed.summary.items} 樣</dd></div>
      <div><dt>照片</dt><dd>${parsed.includesPhotos ? `${parsed.summary.photos} 張` : '這份是文字備份，不含照片'}</dd></div>
    </dl>
    <p>匯入後，手機上現有的清單會被這份備份取代。</p>
    <p class="muted">匯入前會先暫存目前資料，匯入錯了可以到設定按「復原上次匯入」。</p>
    <div class="stack"><button type="button" class="btn btn-danger-solid" id="apply-import">取代並匯入</button></div>`);
  $('#apply-import', sheet).addEventListener('click', async () => {
    try {
      await backup.applyBackup(parsed);
    } catch {
      openSheet(`${sheetHeader('匯入失敗')}<p>手機空間可能不足，現有資料沒有變動。請清出空間後再試一次。</p>`);
      return;
    }
    closeSheet();
    state.q = '';
    state.status = 'all';
    state.cat = 'all';
    await refresh();
    showToast('已匯入');
  });
}

async function maybePromptBackup() {
  if (!hasUnsavedBackup() || state.items.length === 0) return;
  if ($('#sheet').open || $('#confirm').open || $('#clerk').open) return;
  if (state.meta.backupSnoozed) return;
  await openBackupPrompt();
}

// ---- 旅程 ----

function openNewTripSheet() {
  const sheet = openSheet(`
    ${sheetHeader('新增旅程')}
    <form id="trip-form" novalidate>
      <label class="field"><span>名稱</span><input id="t-name" autocomplete="off" placeholder="例如 大阪五日"></label>
      <p class="field-error" id="trip-error" hidden>請填旅程名稱。</p>
      <div class="field"><span>國家與幣別</span><p class="static">日本（JPY）</p></div>
      <div class="sheet-actions"><button type="submit" class="btn btn-primary">建立</button></div>
    </form>`);
  $('#trip-form', sheet).addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#t-name', sheet).value.trim();
    $('#trip-error', sheet).hidden = Boolean(name);
    if (!name) return;
    await model.createTrip({ name, rate: state.trip.rate });
    closeSheet();
    state.tab = 'list';
    await refresh();
    showToast('已建立旅程');
  });
}

function openCopySheet() {
  const others = state.trips.filter((t) => t.id !== state.trip.id);
  const sheet = openSheet(`
    ${sheetHeader('從其他旅程複製')}
    <p class="muted">會把品項複製到「${esc(state.trip.name)}」，並改回未買、清除實際價。</p>
    <div class="trip-list">
      ${others.map((t) => `<button type="button" class="trip-row" data-source="${esc(t.id)}"><span>${esc(t.name)}</span><span class="muted">複製</span></button>`).join('')}
    </div>`);
  sheet.querySelectorAll('[data-source]').forEach((button) => {
    button.addEventListener('click', async () => {
      const count = await model.copyItems(button.dataset.source, state.trip.id);
      closeSheet();
      await refresh();
      showToast(count ? `已複製 ${count} 樣` : '那趟旅程沒有品項');
    });
  });
}

function openInstallHelp() {
  openSheet(`
    ${sheetHeader('加到主畫面')}
    <h3 class="steps-title">iPhone</h3>
    <ol class="steps">
      <li>用 <b>Safari</b> 開啟這個網址。</li>
      <li>點畫面下方的<b>分享</b>按鈕。</li>
      <li>選<b>加入主畫面</b>，再按<b>新增</b>。</li>
    </ol>
    <h3 class="steps-title">Android</h3>
    <ol class="steps">
      <li>用 <b>Chrome</b> 開啟這個網址。</li>
      <li>點右上角的<b>選單</b>（三個點）。</li>
      <li>選<b>安裝應用程式</b>或<b>加到主畫面</b>，再按確認。</li>
    </ol>
    <p class="muted">之後都從主畫面的圖示開啟。瀏覽器和主畫面 App 的資料可能是分開的；如果已經在瀏覽器裡輸入資料，請先備份，再到主畫面 App 匯入。</p>`);
}

async function fetchRate() {
  const response = await fetch(`https://open.er-api.com/v6/latest/${country().rateCode}`, { cache: 'no-store' });
  const data = await response.json();
  const rate = data?.rates?.TWD;
  if (!response.ok || !rate) throw new Error('no rate');
  return Number(rate.toFixed(4));
}

async function updateRateOnline() {
  showToast('正在取得匯率…');
  try {
    const rate = await fetchRate();
    await model.updateTrip({ ...state.trip, rate, rateSource: 'auto', rateUpdatedAt: new Date().toISOString() });
    await refresh();
    showToast('匯率已更新');
  } catch {
    showToast('連不上匯率服務，請確認網路，或直接手動輸入。');
  }
}

// 開啟時在背景更新匯率：手動輸入過、離線、或 12 小時內更新過就不連線，失敗也不打擾使用者。
async function autoUpdateRate() {
  const trip = state.trip;
  if (!navigator.onLine || trip.rateSource === 'manual' || country().currency === 'TWD') return;
  if (trip.rate && trip.rateUpdatedAt && Date.now() - Date.parse(trip.rateUpdatedAt) < RATE_MAX_AGE_MS) return;
  try {
    const rate = await fetchRate();
    if (state.trip.id !== trip.id) return;
    await model.updateTrip({ ...state.trip, rate, rateSource: 'auto', rateUpdatedAt: new Date().toISOString() });
    await refresh();
  } catch {
    // 下次開啟再試。
  }
}

async function saveSetting(input) {
  const trip = { ...state.trip };
  const key = input.dataset.setting;
  if (key === 'displayCurrency') {
    await setMeta('displayCurrency', input.value);
    await refresh();
    return;
  }
  if (key === 'name') {
    const name = input.value.trim();
    if (!name) {
      input.value = trip.name;
      showToast('旅程名稱不能空白');
      return;
    }
    trip.name = name;
  } else {
    const value = parseNumber(input.value);
    if (Number.isNaN(value) || value === 0) {
      input.value = (key === 'rate' ? trip.rate : trip.budgetTwd) ?? '';
      showToast('請填大於 0 的數字');
      return;
    }
    if (key === 'rate') {
      trip.rate = value;
      trip.rateSource = value == null ? 'auto' : 'manual';
      trip.rateUpdatedAt = value == null ? null : new Date().toISOString();
    } else {
      trip.budgetTwd = value;
    }
  }
  await model.updateTrip(trip);
  await refresh();
  showToast('已儲存');
}

// ---- 事件 ----

const actions = {
  tab: (el) => { state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'add-item': () => openItemSheet(null),
  'edit-item': (el) => openItemSheet(el.dataset.id),
  photo: (el) => openItemPhotos(el.dataset.item, Number(el.dataset.index) || 0),
  'delete-item': async (el) => {
    const name = state.products.get(state.items.find((i) => i.id === el.dataset.id)?.productId)?.name;
    const ok = await confirmDialog({ title: `刪除「${name}」？`, body: '照片和價格紀錄會一起刪除，也不會再算進花費。', ok: '刪除', danger: true });
    if (!ok) return;
    await model.deleteItem(el.dataset.id);
    await refresh();
    showToast('已刪除');
  },
  'delete-checked': async () => {
    const checked = state.items.filter((i) => i.purchased);
    const ok = await confirmDialog({ title: `刪除已勾選的 ${checked.length} 樣？`, body: '照片和價格紀錄會一起刪除，也不會再算進花費。', ok: '刪除', danger: true });
    if (!ok) return;
    for (const item of checked) await model.deleteItem(item.id);
    await refresh();
    showToast(`已刪除 ${checked.length} 樣`);
  },
  toggle: async (el) => { await model.togglePurchased(el.dataset.id, state.trip); await refresh(); },
  status: (el) => { state.status = el.dataset.value; renderList(); },
  cat: (el) => { state.cat = state.cat === el.dataset.value ? 'all' : el.dataset.value; renderList(); },
  'close-sheet': () => closeSheet(),
  clerk: (el) => openClerk(el.dataset.id),
  'add-samples': async () => { await model.addSampleItems(state.trip); await refresh(); },
  'clear-samples': async () => { await model.clearSampleItems(); await refresh(); showToast('已清除範例'); },
  'backup-prompt': () => openBackupPrompt(),
  'prepare-backup': (el) => prepareBackup(el.dataset.photos === '1'),
  'snooze-backup': async () => {
    await setMeta('backupPromptSnoozedUntil', new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString());
    closeSheet();
    await refresh();
    showToast(`${SNOOZE_DAYS} 天內不會再提醒備份，仍可到設定備份`);
  },
  'toggle-currency': async () => {
    await setMeta('displayCurrency', displayCode() === 'TWD' ? 'local' : 'TWD');
    await refresh();
  },
  import: () => $('#import-input').click(),
  'undo-import': async () => {
    const ok = await confirmDialog({ title: '復原上次匯入？', body: '會回到匯入前的資料，匯入後新增的內容會消失。', ok: '復原', danger: true });
    if (!ok) return;
    if (await backup.undoImport()) { await refresh(); showToast('已復原'); }
  },
  'switch-trip': async (el) => { await model.setActiveTrip(el.dataset.id); state.cat = 'all'; await refresh(); },
  'new-trip': () => openNewTripSheet(),
  'copy-items': () => openCopySheet(),
  'delete-trip': async () => {
    const ok = await confirmDialog({ title: `刪除「${state.trip.name}」？`, body: '這趟旅程的品項、照片和價格紀錄都會刪除。', ok: '刪除', danger: true });
    if (!ok) return;
    await model.deleteTrip(state.trip.id);
    await refresh();
    showToast('已刪除旅程');
  },
  'install-help': () => openInstallHelp(),
  'update-rate': () => updateRateOnline(),
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el);
});

// 長按縮圖：擋掉系統放大縮圖的預覽，改開清晰的大圖。
let pressTimer;
document.addEventListener('pointerdown', (event) => {
  const el = event.target.closest('.zoomable');
  if (!el) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => el.click(), LONG_PRESS_MS);
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => clearTimeout(pressTimer));
}
document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.zoomable, .viewer, .clerk')) event.preventDefault();
});

$('#view').addEventListener('change', (event) => {
  if (event.target.dataset.setting) saveSetting(event.target);
});

$('#import-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) handleImportFile(file);
});

function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (worker) =>
    showToast('有新版本，清單資料不受影響', { label: '更新', run: () => worker.postMessage('skipWaiting') });
  navigator.serviceWorker.register('sw.js').then((registration) => {
    if (registration.waiting && hadController) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch(() => {});
}

async function start() {
  await refresh();
  navigator.storage?.persist?.().catch(() => {});
  watchForUpdates();
  autoUpdateRate();
  await maybePromptBackup();
}

start().catch(() => {
  $('#view').innerHTML = '<div class="empty-state"><h2>無法開啟資料</h2><p>請確認沒有使用私密瀏覽，然後重新開啟 App。</p></div>';
});
