/* The ORDER SHEET'S OWN WORDS — not the catalogue's.
 *
 * These two things look alike and must not be treated alike.
 *
 * The catalogue ships BLANK and is translated by the boat, because half of it
 * is Scottish butcher and baker vocabulary — polony, Lorne, neeps, tattie
 * waffles, softies, butteries — and a machine will not get those right. A wrong
 * word on a provisions order gets the wrong food delivered to a boat that is
 * about to sail.
 *
 * The sheet's FURNITURE is a different class of word: about a dozen fixed,
 * generic terms — quantity, unit, item, note, page — that mean the same thing
 * on any order form in any trade. Those are translated here, in code, once.
 *
 * AND THE ENGLISH IS PRINTED BESIDE EVERY ONE OF THEM. That is what makes it
 * safe: if a word of mine is off, the shop still has the English to read, and
 * the cost of my being wrong is nothing. It is the same rule the item names
 * follow — never instead of the English, always beside it.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED: the category headings. They are the
 * boat's own shelf names off a Scottish order form and they do not always
 * describe their contents — "Baking" on that form holds BBQ sauce, beetroot
 * and a big bag of rice. Translating that gives a confident foreign word that
 * is wrong about what is under it, which is worse than leaving it English. A
 * shop picks by item name regardless.
 */

export const SHEET_WORDS = {
  en: {
    title: 'STORES ORDER', qty: 'QTY', unit: 'UNIT', item: 'ITEM', note: 'NOTE',
    mealsFor: 'Meals for', page: 'Page', of: 'of', items: 'items',
    generated: 'generated', continued: 'continued', forN: 'for',
  },
  no: {
    title: 'PROVIANTBESTILLING', qty: 'ANTALL', unit: 'ENHET', item: 'VARE', note: 'MERKNAD',
    mealsFor: 'Måltider til', page: 'Side', of: 'av', items: 'varer',
    generated: 'laget', continued: 'fortsatt', forN: 'til',
  },
  da: {
    title: 'PROVIANTBESTILLING', qty: 'ANTAL', unit: 'ENHED', item: 'VARE', note: 'BEMÆRKNING',
    mealsFor: 'Måltider til', page: 'Side', of: 'af', items: 'varer',
    generated: 'lavet', continued: 'fortsat', forN: 'til',
  },
}

/* Unit words in the supplier's language. Same class as the furniture above —
 * a case is a case in any trade — and the English is carried in the key at the
 * foot of the sheet, so nothing here can be read wrongly without a fallback.
 * `dozen` is invariant in all three, which is why plural and singular match. */
export const UNIT_WORDS = {
  no: {
    pack: ['pakke', 'pakker'], case: ['kasse', 'kasser'], litre: ['liter', 'liter'],
    doz: ['dusin', 'dusin'], half_doz: ['halvt dusin', 'halvt dusin'],
  },
  da: {
    pack: ['pakke', 'pakker'], case: ['kasse', 'kasser'], litre: ['liter', 'liter'],
    doz: ['dusin', 'dusin'], half_doz: ['halvt dusin', 'halvt dusin'],
  },
}

export const words = (lang) => SHEET_WORDS[lang] || SHEET_WORDS.en

// A furniture label with the English beside it, unless it IS the English.
export const bothWords = (lang, key) => {
  const t = words(lang)[key]
  const en = SHEET_WORDS.en[key]
  return !t || t === en ? en : `${t} / ${en}`
}

/* Which lines will print in English because nobody has given them a word yet.
 *
 * Named on the sheet AND on the page, rather than left to be discovered by the
 * shop. A half-translated order that does not say it is half translated is the
 * failure worth guarding against — the cook believes the list is ready, and
 * the first anyone knows is a delivery that is short. */
export function missingTranslations(lines, byKey, lang) {
  if (lang === 'en') return []
  return (lines || []).filter((l) => {
    const item = byKey.get(l.item_key)
    const t = lang === 'no' ? item?.no : item?.da
    return !t || !String(t).trim()
  })
}
