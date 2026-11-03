// 價格相關的純函式。

// 接受逗號與全形數字（日文輸入法常見），空白回傳 null，不合法回傳 NaN。
export function parseNumber(value) {
  const text = String(value ?? '')
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function taxIncluded(price, taxMode, taxRate, decimals = 0) {
  if (price == null) return null;
  if (taxMode !== 'excl') return price;
  return roundTo((price * (100 + taxRate)) / 100, decimals);
}

export function formatMoney(value, country) {
  if (value == null) return '';
  const digits = value.toLocaleString('en-US', {
    minimumFractionDigits: country.decimals,
    maximumFractionDigits: country.decimals,
  });
  return `${country.symbol}${digits}`;
}

export function toTwd(value, rate) {
  return value == null || !rate ? null : Math.round(value * rate);
}

export function formatTwd(value) {
  return value == null ? '' : `NT$${value.toLocaleString('en-US')}`;
}

export function itemUnitPrice(item, country) {
  const price = item.actualPrice ?? item.estPrice;
  return taxIncluded(price, item.taxMode, item.taxRate, country.decimals);
}

// 已買的金額算進「已花」，全部品項算進「預估總額」；實際價優先於預估價。
export function summarize(items, country) {
  const result = { spent: 0, total: 0, remaining: 0, doneCount: 0, count: items.length, unpriced: 0 };
  for (const item of items) {
    const unit = itemUnitPrice(item, country);
    if (unit == null) result.unpriced += 1;
    const amount = (unit ?? 0) * (item.qty || 1);
    result.total += amount;
    if (item.purchased) {
      result.spent += amount;
      result.doneCount += 1;
    } else {
      result.remaining += amount;
    }
  }
  return result;
}
