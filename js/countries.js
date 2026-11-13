// 國家設定集中在這裡。之後要加其他國家，新增一組設定即可。
export const COUNTRIES = {
  JP: {
    code: 'JP',
    name: '日本',
    currency: 'JPY',
    currencyName: '日圓',
    symbol: '¥',
    decimals: 0,
    locale: 'ja-JP',
    defaultTaxMode: 'incl',
    taxRates: [8, 10],
    defaultTaxRate: 10,
    units: ['錠', '顆', '包', '個', '枚', 'ml', 'L', 'g', 'kg'],
    categories: [
      { id: 'drug', name: '藥妝', taxRate: 10 },
      { id: 'health', name: '保健食品', taxRate: 8 },
      { id: 'snack', name: '零食', taxRate: 8 },
      { id: 'gift', name: '伴手禮', taxRate: 8 },
      { id: 'food', name: '食品飲料', taxRate: 8 },
      { id: 'beauty', name: '美妝保養', taxRate: 10 },
      { id: 'home', name: '生活用品', taxRate: 10 },
      { id: 'fashion', name: '服飾配件', taxRate: 10 },
      { id: 'tech', name: '3C 家電', taxRate: 10 },
      { id: 'other', name: '其他', taxRate: 10 },
    ],
    stores: ['松本清', '唐吉訶德', 'Sundrug', 'Welcia', 'Costco', 'AEON', 'BIC CAMERA', 'UNIQLO', '機場免稅店'],
    clerkPhrases: [
      { text: 'これはどこにありますか？', zh: '請問這個在哪裡？' },
      { text: '在庫はありますか？', zh: '請問還有庫存嗎？' },
      { text: 'これをください。', zh: '我要買這個。' },
    ],
    rateCode: 'JPY',
    // 「準備」分頁一鍵加入的常用事項。
    prepTasks: [
      '護照（效期 6 個月以上）',
      '機票',
      '住宿',
      'Visit Japan Web 登錄',
      '網卡或 eSIM',
      '旅遊保險',
      '換日圓、確認信用卡',
      '交通票券（IC 卡、JR Pass 等）',
      '充電器、行動電源、轉接頭',
      '常備藥品',
      '行李打包',
    ],
  },
};

export const DEFAULT_COUNTRY = 'JP';

export function getCountry(code) {
  return COUNTRIES[code] || COUNTRIES[DEFAULT_COUNTRY];
}

export function getCategory(country, id) {
  return country.categories.find((c) => c.id === id) || country.categories[country.categories.length - 1];
}
