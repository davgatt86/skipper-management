/* The stores catalogue — what the boat can order.
 *
 * Transcribed from the Whitehills Premier order form the boat already uses
 * (iCloudDrive/Audacious_/Stores List.pdf, four scanned pages). Eighteen
 * categories, about 335 items, in the order the paper form lists them so a
 * cook reading one and then the other is not hunting.
 *
 * IT LIVES IN CODE, WITH PER-FLEET OVERRIDES MERGED OVER IT — the same shape
 * as the market rules, for the same reason. Seed 335 rows per fleet instead
 * and a Danish translation added next month reaches nobody, because every boat
 * is holding a frozen copy of the day it first saved.
 *
 * TRANSLATIONS SHIP BLANK, deliberately. Half this list is Scottish butcher
 * and baker vocabulary — polony, Lorne, neeps, butteries, softies, tattie
 * waffles — and a machine will not get those right. A wrong word on a
 * provisions order gets the wrong food onto a boat that is about to sail, so
 * the print falls back to English rather than guessing, and the cook fills
 * them in as he learns them.
 */

/* How a thing is ordered. The paper form carries some of this in the item
 * name already ("VEG COOK OIL 1LITRE" and "5LITRE" are two separate lines),
 * which is the paper way of saying the unit belongs to the item. */
export const UNITS = [
  { key: 'unit', label: 'Unit', short: '' },
  { key: 'pack', label: 'Pack', short: 'pk' },
  { key: 'case', label: 'Case', short: 'cs' },
  { key: 'litre', label: 'Litre', short: 'L' },
  { key: 'half_doz', label: 'Half dozen', short: '½dz' },
  { key: 'doz', label: 'Dozen', short: 'dz' },
]
export const unitLabel = (k) => UNITS.find((u) => u.key === k)?.label || 'Unit'
export const unitShort = (k) => UNITS.find((u) => u.key === k)?.short ?? ''

// An item is a plain string, or [name, unit] where the unit is not "unit".
const CAT = [
  ['BAKERS', 'Bakers', [
    'Apple Crumble', 'Apple Tart', 'Bagels', 'Brioche Buns', 'Brown Softies', 'Butteries',
    'Cherry Cake', 'Doughnuts', 'Eves Pudding', 'Fruit Cake', 'Fruit Scones', 'Ginger Cake',
    'Home Bakes', 'Hot Dog Buns', 'Pancakes', 'Rhubarb Crumble', 'Madeira Cake', 'Muffins',
    'Scones', 'Softies', 'Sponges', 'Swiss Roll', 'White Loaf', 'WM Loaf',
  ]],
  ['BAKING', 'Baking', [
    'BBQ Sauce', 'Beetroot', 'Big Bag Rice', 'Bisto', 'Bisto Granules', 'Black Pepper',
    'Branston Pickle', 'Cheese Sauce', 'Cornflour', 'Curry Powder', 'Dolmio', 'Dolmio White',
    'Gravy Salt', 'HP Sauce', 'Lea Perrins', 'Mango Chutney', 'Mayonnaise', 'Mustard',
    'Olive Oil', 'Oxo Cubes', 'Parsley Sauce', 'Pepper Sauce', 'Plain Flour', 'Ruskoline',
    'Salad Cream', 'Salt', 'Soy Sauce', 'SR Flour', 'Stock Cubes', 'Stock Pots',
    'Super Noodles', 'Sweet Chilli Sauce', 'Sweet & Sour', 'Tabasco', 'Tartare Sauce',
    'Tomato Sauce', 'Uncle Ben Curry', ['Veg Cook Oil 1 Litre', 'litre'],
    ['Veg Cook Oil 5 Litre', 'litre'], 'Vinegar', 'White Pepper', 'White Sauce',
  ]],
  ['CHILL', 'Chill', [
    ['Cases UHT', 'case'], 'Cheddar Cheese', 'Cheese Slices', 'Cheese Spread', 'Chicken Pie',
    'Curry Pie', 'Double Cream', 'DTC Yoghurts', 'Grated Cheese', 'Strong Cheese', 'Lard',
    ['Large Eggs', 'doz'], 'Lurpak Butter', 'Lurpak Spreadable', 'Macaroni Pie', 'Mince Pies',
    'Muller Corners', 'Muller Light', 'Pergals Full Fat', 'Pergals Semi Skimmed',
    'Philadelphia Cheese', 'Philly Tubes', 'Rustlers', 'Sandwich Fillers 500g', 'Single Cream',
    'Smoked Sausage', 'Steak Pie', ['2 Litre Semi Skim', 'litre'],
  ]],
  ['FRUIT', 'Fruit', [
    'Apples', 'Bananas', 'Grapes', 'Lemons', 'Limes', 'Melon', 'Oranges', 'Pears',
    'Pink Lady Apples', 'Plums',
  ]],
  ['VEGETABLES', 'Vegetables', [
    'Brocolli', 'Cabbage', 'Cucumber', 'Carrots', 'Cauliflower', 'Chillies', 'Courgettes',
    'Garlic', 'Ginger', 'Leeks', 'Lettuce', 'Neeps', 'Onions', 'Red Onions', 'Peppers',
    'Potatoes 25 Kilo', 'Tomatoes',
  ]],
  ['CRISPS', 'Crisps and Snacks', ['Crisps', 'Peanuts']],
  ['BUTCHERS', 'Butchers', [
    'Bacon', 'Beef Burgers', 'Beef Sausage', 'Boiled Ham', 'Brisket', 'Chicken Supremes',
    'Chopped Pork', 'Corned Beef', 'Gammon Steak', 'Lamb Chops', 'Leg Lamb', 'Lorne Sausage',
    'Mince', 'Sausage Rolls', 'Sirloin Steak', 'Silverside', 'Sliced Haggis', 'Stewing Steak',
    'Pork Chops', 'Pork Sausage', 'Roast Beef', 'Roast Ham', 'Sliced Polony', 'White Pudding',
    'Whole Black Pudding', 'Whole Chicken', 'Whole Polony',
  ]],
  ['TEACOFFEE', 'Tea and Coffee', [
    'Coffee (Lg)', 'Coffee (Sm)', 'Coffee Mate', 'Drinking Choc', 'Ovaltine',
    ['Tea Bags', 'pack'], ['Tea Bags (Lg)', 'pack'],
  ]],
  ['CANSFRUIT', 'Cans, Fruit and Puddings', [
    'Angel Delight', 'Condensed Milk', 'Custard', 'Evaporated Milk', 'Fruit Cocktail',
    'Jellies', 'Mandarins', 'Peaches', 'Pears', 'Pineapples', 'Prunes', 'Semolina',
    'Steam Puddings', 'Strawberries', 'Raspberries', 'Rice',
  ]],
  ['CEREALS', 'Cereals', [
    'Alpen', 'Bran Flakes', 'Cheerios', 'Coco Pops', 'Cornflakes', 'Crunch Nut', 'Frosties',
    'Fruit n Fibre', 'Porridge Oats', 'Rice Krispies', 'Special K', 'Sugar Puffs', 'Oatmeal',
    'Weetabix',
  ]],
  ['JUICE', 'Juice and Cans', [
    ['Coke', 'case'], ['Diet Coke', 'case'], ['Diet Irn Bru', 'case'], 'Diet Pepsi 2L',
    ['Dr Pepper', 'case'], ['Fanta', 'case'], ['Fanta Zero', 'case'], 'Flavoured Water 500ml',
    'Fresh Apple', 'Fresh Orange', 'Fresh Pineapple', ['Irn Bru', 'case'], 'Oasis Berry',
    'Oasis Citrus', 'Orange Lucozade', 'Pepsi 2L', ['Pepsi Max 330ml', 'case'], 'Pepsi Max 2L',
    'Robinsons Diluting', 'Shandy', ['Sprite', 'case'], 'Vimto', ['Water 500ml', 'case'],
    ['Water 1.5L', 'case'], ['Water Sparkling 500ml', 'case'], ['7 Up', 'case'],
  ]],
  ['CANSVEG', 'Cans, Veg and Meat', [
    'Anchovies', 'Baked Beans', 'Beans & Sausage', 'Carrots', 'Coconut Milk', 'Corned Beef',
    'Cup a Soup', 'Garden Peas', 'Hot Dogs', 'Macaroni', 'Mackerel', 'Mushrooms',
    'Kidney Beans', 'Pilchards', 'Pot Noodles', 'Processed Peas', 'Ravioli', 'Sardines',
    'Spaghetti', 'Spam Meat', 'Sweetcorn', 'Tomatoes', 'Tuna',
  ]],
  ['SUGARJAM', 'Sugar and Jams', [
    'Granulated Sugar', 'Honey', 'Lemon Curd', 'Marmalade', 'Nutella', 'Peanut Btr Crunchy',
    'Peanut Btr Smooth', 'Raspberry Jam', 'Strawberry Jam', 'Sweetex', 'Syrup',
  ]],
  ['BISCUITS', 'Biscuits', [
    'Butter Biscs', 'Choc Bisc', 'Cream Bisc', 'Cream Crackers', 'Oatcakes', 'Plain Bisc',
    'Rich Tea', 'Shortbread', 'TUC',
  ]],
  ['PASTA', 'Pasta and Rice', [
    'Boil in Bag Rice', 'Garlic Puree', 'Lasagne Sheets', 'Macaroni', 'Nan Bread',
    'Poppadoms', 'Spaghetti', 'Tomato Puree',
  ]],
  ['FROZEN', 'Frozen', [
    'Beefburgers', 'Cauliflower', 'Cheese Cake Lrg', 'Cheese Cake Sml', 'Cheese Hamwich',
    'Chips', 'Chicken Burgers', 'Chicken Fillets', 'Green Beans', 'Crispy Pancakes',
    'Garlic Bread', 'Honeycomb Ice Cream', 'Haddock', 'King Rib', 'Smoked Haddock',
    'Mini Kievs', 'Mix Veg', 'Onion Rings', 'Peas', 'Pizza', 'Puff Pastry',
    'Rasp Ripple Ice Cream', 'Richmond Sausage', 'Scampi', 'Sprouts', 'Tattie Waffles',
    'Turkey Drummers', 'Vanilla Ice Cream', 'Yorkshire Pudding',
  ]],
  ['HOUSEHOLD', 'Household', [
    'Air Freshener', 'Beecham Powders', 'Black Bags', 'Bleach', 'Brillo Pads', 'Cif',
    'Cillit Bang', 'Cough Mixture', 'Deodorant', 'Dettol', 'Dishwasher Tablets', 'Dish Cloths',
    'Dish Towels', 'Domestos', 'Eye Wash', 'Fabric Softener', 'Fairy Liquid', 'Flash',
    'Flash Spray Bleach', 'J Cloths', 'Ibuprofen', 'Kitchen Roll', 'Mugs', 'Neurofen',
    'Toothpaste', 'Toothbrush', 'Oven Cleaner', 'Paracetamol', 'Plasters', 'Razors',
    'Rennies', 'Soap Tablets', 'Shampoo', 'Shaving Foam', 'Shower Gel', 'Toilet Soap',
    'Toilet Rolls', 'Soap Powder', 'Sponge Scourers', 'Tinfoil', 'Wire Scourers',
  ]],
  ['MISC', 'Miscellaneous', []],
]

export const CATEGORIES = CAT.map(([key, label]) => ({ key, label }))
export const categoryLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label || k

/* A stable id for a catalogue item. Built from the category and the name
 * rather than a number, so re-ordering the list above never re-points a line
 * on a saved order at a different tin. */
export const itemKey = (category, name) =>
  `${category}:${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

export const DEFAULT_ITEMS = CAT.flatMap(([key, , items]) =>
  items.map((it) => {
    const [name, unit] = Array.isArray(it) ? it : [it, 'unit']
    return { key: itemKey(key, name), category: key, name, unit, no: '', da: '', custom: false }
  }),
)

/* Merge the fleet's own rows over the shipped list.
 *
 * An override is keyed the same way, so a fleet that renames an item or fills
 * in its Danish keeps that, while everything it has not touched still tracks
 * the shipped catalogue. `hidden` retires an item without deleting it — the
 * saved orders that reference it must keep reading. */
export function resolveCatalogue(rows) {
  const byKey = new Map(DEFAULT_ITEMS.map((i) => [i.key, i]))
  for (const r of rows || []) {
    const base = byKey.get(r.item_key) || {
      key: r.item_key, category: r.category || 'MISC', name: r.name, unit: 'unit', no: '', da: '', custom: true,
    }
    byKey.set(r.item_key, {
      ...base,
      category: r.category || base.category,
      name: r.name || base.name,
      unit: r.unit || base.unit,
      no: r.name_no ?? base.no,
      da: r.name_da ?? base.da,
      hidden: !!r.hidden,
      custom: base.custom || !DEFAULT_ITEMS.some((d) => d.key === r.item_key),
    })
  }
  return [...byKey.values()].filter((i) => !i.hidden)
}

/* What to print for a supplier. Falls back to English when the translation is
 * missing — an English word the supplier queries beats a confident wrong one
 * on an order that has to be right before the boat sails. */
export function supplierName(item, lang) {
  const t = lang === 'no' ? item.no : lang === 'da' ? item.da : ''
  return t && t.trim() ? t.trim() : item.name
}
export const LANGS = [
  { key: 'en', label: 'English' },
  { key: 'no', label: 'Norsk' },
  { key: 'da', label: 'Dansk' },
]
