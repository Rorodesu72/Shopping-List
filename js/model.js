// 資料操作。三層結構：種類（category）→ 商品（product）→ 包裝容量（variant）。
import { get, getAll, getMeta, newId, put, remove, setMeta } from './db.js';
import { COUNTRIES, DEFAULT_COUNTRY, getCategory, getCountry } from './countries.js';
import { taxIncluded } from './money.js';

const normalize = (text) => (text || '').trim().toLowerCase();
const now = () => new Date().toISOString();

export async function markChanged({ photo = false } = {}) {
  await setMeta('changesSinceBackup', (await getMeta('changesSinceBackup', 0)) + 1);
  if (photo) await setMeta('photoChangesSinceFull', (await getMeta('photoChangesSinceFull', 0)) + 1);
}

// ---- 旅程 ----

export async function createTrip({ name, countryCode = DEFAULT_COUNTRY, rate = null, budgetTwd = null }) {
  const trip = { id: newId('trip'), name, countryCode, rate, rateUpdatedAt: null, budgetTwd, createdAt: now() };
  await put('trips', trip);
  await setMeta('activeTripId', trip.id);
  await markChanged();
  return trip;
}

export async function ensureInitialData() {
  const trips = await getAll('trips');
  if (trips.length === 0) {
    const trip = await createTrip({ name: `${COUNTRIES[DEFAULT_COUNTRY].name}之旅` });
    await setMeta('changesSinceBackup', 0);
    return trip;
  }
  const activeId = await getMeta('activeTripId');
  const active = trips.find((t) => t.id === activeId);
  if (active) return active;
  await setMeta('activeTripId', trips[0].id);
  return trips[0];
}

export async function updateTrip(trip) {
  await put('trips', trip);
  await markChanged();
}

export async function setActiveTrip(id) {
  await setMeta('activeTripId', id);
}

export async function deleteTrip(id) {
  const items = (await getAll('items')).filter((i) => i.tripId === id);
  for (const item of items) await deleteItem(item.id, { mark: false });
  await remove('trips', id);
  const rest = await getAll('trips');
  await setMeta('activeTripId', rest[0]?.id ?? null);
  await markChanged();
}

export async function copyItems(fromTripId, toTripId) {
  const source = (await getAll('items')).filter((i) => i.tripId === fromTripId);
  for (const item of source) {
    await put('items', {
      ...item,
      id: newId('item'),
      tripId: toTripId,
      purchased: false,
      purchasedAt: null,
      actualPrice: null,
      sample: false,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  if (source.length) await markChanged();
  return source.length;
}

// ---- 品項 ----

async function findOrCreateProduct({ name, foreignName, categoryId }) {
  const products = await getAll('products');
  const found = products.find(
    (p) => normalize(p.name) === normalize(name) && normalize(p.foreignName) === normalize(foreignName),
  );
  if (found) {
    if (found.categoryId !== categoryId) await put('products', { ...found, categoryId, updatedAt: now() });
    return found.id;
  }
  const id = newId('prod');
  await put('products', { id, name: name.trim(), foreignName: (foreignName || '').trim(), categoryId, createdAt: now(), updatedAt: now() });
  return id;
}

async function findOrCreateVariant({ productId, amount, unit, packCount }) {
  const variants = await getAll('variants');
  const pack = packCount || 1;
  const size = amount ?? null;
  const unitName = size == null ? '' : unit || '';
  const found = variants.find(
    (v) => v.productId === productId && (v.amount ?? null) === size && (v.unit || '') === unitName && (v.packCount || 1) === pack,
  );
  if (found) return found.id;
  const id = newId('var');
  // barcode 先預留，第二階段掃條碼時使用。
  await put('variants', { id, productId, amount: size, unit: unitName, packCount: pack, barcode: null, createdAt: now() });
  return id;
}

async function findOrCreateStore(name, countryCode) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const stores = await getAll('stores');
  const found = stores.find((s) => normalize(s.name) === normalize(trimmed) && s.countryCode === countryCode);
  if (found) return found.id;
  const id = newId('store');
  await put('stores', { id, name: trimmed, countryCode, createdAt: now() });
  return id;
}

async function deletePhotoIfUnused(photoId, exceptItemId) {
  if (!photoId) return;
  const items = await getAll('items');
  if (items.some((i) => i.photoId === photoId && i.id !== exceptItemId)) return;
  await remove('photos', photoId);
}

async function syncPriceRecord(item, country) {
  const id = `pr_${item.id}`;
  if (item.actualPrice == null) {
    await remove('priceRecords', id);
    return;
  }
  await put('priceRecords', {
    id,
    itemId: item.id,
    variantId: item.variantId,
    storeId: item.storeId,
    photoId: item.photoId,
    price: item.actualPrice,
    taxMode: item.taxMode,
    taxRate: item.taxRate,
    priceWithTax: taxIncluded(item.actualPrice, item.taxMode, item.taxRate, country.decimals),
    currency: country.currency,
    date: item.purchasedAt || now(),
  });
}

export async function saveItem(trip, form, draftPhoto, removePhoto) {
  const country = getCountry(trip.countryCode);
  const existing = form.id ? await get('items', form.id) : null;
  const productId = await findOrCreateProduct(form);
  const variantId = await findOrCreateVariant({ ...form, productId });
  const storeId = await findOrCreateStore(form.storeName, trip.countryCode);

  let photoId = existing?.photoId ?? null;
  const oldPhotoId = photoId;
  if (draftPhoto) {
    photoId = newId('photo');
    await put('photos', { id: photoId, ...draftPhoto, createdAt: now() });
  } else if (removePhoto) {
    photoId = null;
  }

  const purchased = existing?.purchased ?? false;
  const item = {
    id: existing?.id ?? newId('item'),
    tripId: trip.id,
    productId,
    variantId,
    storeId,
    photoId,
    qty: form.qty || 1,
    estPrice: form.estPrice,
    actualPrice: form.actualPrice,
    taxMode: form.taxMode,
    taxRate: form.taxRate,
    forWhom: (form.forWhom || '').trim(),
    note: (form.note || '').trim(),
    purchased,
    purchasedAt: existing?.purchasedAt ?? null,
    sample: existing?.sample ?? false,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  await put('items', item);
  if (oldPhotoId && oldPhotoId !== photoId) await deletePhotoIfUnused(oldPhotoId, item.id);
  await syncPriceRecord(item, country);
  await markChanged({ photo: Boolean(draftPhoto) });
  return item;
}

export async function togglePurchased(id, trip) {
  const item = await get('items', id);
  if (!item) return;
  item.purchased = !item.purchased;
  item.purchasedAt = item.purchased ? now() : null;
  item.updatedAt = now();
  await put('items', item);
  await syncPriceRecord(item, getCountry(trip.countryCode));
  await markChanged();
}

export async function deleteItem(id, { mark = true } = {}) {
  const item = await get('items', id);
  if (!item) return;
  await remove('items', id);
  await remove('priceRecords', `pr_${id}`);
  await deletePhotoIfUnused(item.photoId, id);
  if (mark) await markChanged();
}

// ---- 範例資料 ----

export async function addSampleItems(trip) {
  const country = getCountry(trip.countryCode);
  const samples = [
    { name: '合利他命 EX Plus（範例）', foreignName: 'アリナミンEXプラス', categoryId: 'health', amount: 270, unit: '錠', qty: 2, estPrice: 5980, storeName: '松本清', forWhom: '媽媽' },
    { name: '眼藥水（範例）', foreignName: 'サンテFX', categoryId: 'drug', amount: 12, unit: 'ml', qty: 3, estPrice: 450, storeName: '唐吉訶德' },
    { name: '東京芭娜娜（範例）', foreignName: '東京ばな奈', categoryId: 'gift', amount: 8, unit: '個', qty: 1, estPrice: 1080, storeName: '機場免稅店', note: '回國當天再買' },
  ];
  for (const sample of samples) {
    const category = getCategory(country, sample.categoryId);
    const saved = await saveItem(trip, { ...sample, packCount: 1, actualPrice: null, taxMode: 'incl', taxRate: category.taxRate });
    await put('items', { ...saved, sample: true });
  }
}

export async function clearSampleItems() {
  const items = (await getAll('items')).filter((i) => i.sample);
  for (const item of items) await deleteItem(item.id, { mark: false });
  if (items.length) await markChanged();
}
