// Data behind the fixture sites. A fictional outdoor store, Pinecrest Outfitters,
// with a catalog, order history, developer docs, help center and account pages.
// Everything is deterministic so eval graders can compute the right answers.

export interface Product {
  id: string;
  name: string;
  category: 'Tents' | 'Packs' | 'Sleep' | 'Camp';
  price: number;
  rating: number;
  reviews: number;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  { id: 'ridgeline-2p', name: 'Ridgeline 2P Tent', category: 'Tents', price: 349, rating: 4.8, reviews: 412, blurb: 'Two-person backpacking tent, 1.9 kg packed.' },
  { id: 'basecamp-4p', name: 'Basecamp 4P Tent', category: 'Tents', price: 429, rating: 4.5, reviews: 233, blurb: 'Roomy family tent with two doors and a vestibule.' },
  { id: 'trailhead-1p', name: 'Trailhead 1P Tent', category: 'Tents', price: 199, rating: 4.6, reviews: 301, blurb: 'Solo tent that pitches with trekking poles.' },
  { id: 'summit-dome-3p', name: 'Summit Dome 3P Tent', category: 'Tents', price: 389, rating: 4.3, reviews: 158, blurb: 'Four-season dome for wind and snow.' },
  { id: 'meadow-6p', name: 'Meadow 6P Tent', category: 'Tents', price: 529, rating: 4.1, reviews: 97, blurb: 'Cabin tent with near-vertical walls.' },
  { id: 'switchback-45', name: 'Switchback 45L Pack', category: 'Packs', price: 189, rating: 4.7, reviews: 520, blurb: 'Framed pack for overnight trips.' },
  { id: 'daypack-22', name: 'Daypack 22L', category: 'Packs', price: 89, rating: 4.4, reviews: 640, blurb: 'Light pack with a hydration sleeve.' },
  { id: 'ember-20', name: 'Ember 20° Sleeping Bag', category: 'Sleep', price: 219, rating: 4.6, reviews: 288, blurb: 'Down bag rated to 20°F.' },
  { id: 'loft-pad', name: 'Loft Sleeping Pad', category: 'Sleep', price: 119, rating: 4.2, reviews: 175, blurb: 'Insulated inflatable pad, R-value 4.2.' },
  { id: 'cedar-stool', name: 'Cedar Camp Stool', category: 'Camp', price: 42, rating: 4.5, reviews: 133, blurb: 'Folding three-leg stool.' },
  { id: 'cedar-chair', name: 'Cedar Camp Chair', category: 'Camp', price: 64, rating: 4.3, reviews: 211, blurb: 'Low chair with a mesh back.' },
  { id: 'alder-table', name: 'Alder Roll Table', category: 'Camp', price: 79, rating: 4.0, reviews: 64, blurb: 'Aluminum table that rolls into a sack.' },
  { id: 'firefly-lantern', name: 'Firefly Lantern', category: 'Camp', price: 36, rating: 4.4, reviews: 402, blurb: 'Rechargeable lantern, 300 lumens.' },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

export const ORDERS_PER_PAGE = 10;
export const NEWEST_ORDER = 10450;
export const ORDER_COUNT = 50;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Order 10450 shipped on May 31, 2026; each older order is three days earlier. */
export function orderDate(orderNumber: number): string {
  const date = new Date(Date.UTC(2026, 4, 31));
  date.setUTCDate(date.getUTCDate() - (NEWEST_ORDER - orderNumber) * 3);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function orderItem(orderNumber: number): Product {
  return PRODUCTS[orderNumber % PRODUCTS.length]!;
}

export const RATE_LIMITS = [
  { plan: 'Starter', catalog: '300', orders: '120' },
  { plan: 'Pro', catalog: '3,000', orders: '1,200' },
  { plan: 'Enterprise', catalog: 'Custom', orders: 'Custom' },
];

export const DEFAULT_SETTINGS = { newsletter: 'weekly', sms: true, email: true };
