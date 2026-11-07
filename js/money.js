// 價格相關的純函式。
// 每個價格都記著自己的幣別（當地幣或台幣），要加總時再用旅程匯率換成同一種幣別。

export const TWD = { code: 'TWD', symbol: 'NT$', decimals: 0, name: '台幣' };

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

// 這趟旅程可用的幣別：當地幣在前，台幣在後。
export function currencies(country) {
  const local = { code: country.currency, symbol: country.symbol, decimals: country.decimals, name: country.currencyName };
  return local.code === TWD.code ? [local] : [local, TWD];
}

export function currencyOf(country, code) {
  return currencies(country).find((c) => c.code === code) ?? currencies(country)[0];
}

export function formatMoney(value, currency) {
  if (value == null) return '';
  const digits = value.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
  return `${currency.symbol}${digits}`;
}

export function formatTwd(value) {
  return formatMoney(value, TWD);
}

// rate 是「1 當地幣 = 多少台幣」。缺匯率又需要換算時回傳 NaN。
export function convert(value, fromCode, toCode, country, rate) {
  if (value == null) return null;
  if (fromCode === toCode) return value;
  if (!rate) return NaN;
  const to = currencyOf(country, toCode);
  const inTwd = fromCode === TWD.code ? value : value * rate;
  const result = toCode === TWD.code ? inTwd : inTwd / rate;
  return roundTo(result, to.decimals);
}

// 品項的含稅單價，用填寫時的幣別。實際價優先於預估價。
export function itemUnitPrice(item, country) {
  const useActual = item.actualPrice != null;
  const price = useActual ? item.actualPrice : item.estPrice;
  if (price == null) return null;
  const code = (useActual ? item.actualCurrency : item.estCurrency) || country.currency;
  const currency = currencyOf(country, code);
  return { value: taxIncluded(price, item.taxMode, item.taxRate, currency.decimals), currency };
}

// 換算成指定幣別的含稅單價：沒填價回傳 null，缺匯率無法換算回傳 NaN。
export function itemUnitPriceIn(item, country, rate, toCode) {
  const unit = itemUnitPrice(item, country);
  if (!unit) return null;
  return convert(unit.value, unit.currency.code, toCode, country, rate);
}

// 已買的金額算進「已花」，全部品項算進「預估總額」；金額都換成 toCode 幣別。
export function summarize(items, country, rate, toCode) {
  const result = { spent: 0, total: 0, remaining: 0, doneCount: 0, count: items.length, unpriced: 0, unconverted: 0 };
  for (const item of items) {
    const unit = itemUnitPriceIn(item, country, rate, toCode);
    if (unit == null) result.unpriced += 1;
    else if (Number.isNaN(unit)) result.unconverted += 1;
    const amount = unit == null || Number.isNaN(unit) ? 0 : unit * (item.qty || 1);
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
