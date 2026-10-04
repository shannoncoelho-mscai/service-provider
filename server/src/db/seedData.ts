/**
 * Development seed data — imported by src/db/seed.ts.
 * All fictional. All accounts share DEV_PASSWORD (development only).
 */

export const DEV_PASSWORD = 'Password123!';

/** Deterministic UUIDs so reseeding is stable and referenceable in docs. */
export const u = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysFromNow = (d: number): Date => new Date(Date.now() + d * DAY_MS);

// --- categories: [name, slug, description] (ids u(1000)..u(1007)) ---------
const CAT: [string, string, string][] = [
  ['Plumbing', 'plumbing', 'Pipes, drains, leaks and fixtures'],
  ['Electrical', 'electrical', 'Wiring, panels, outlets and lighting'],
  ['Carpentry', 'carpentry', 'Custom woodwork, doors and fixtures'],
  ['Painting', 'painting', 'Interior and exterior painting'],
  ['Cleaning', 'cleaning', 'Home and office cleaning'],
  ['Appliance Repair', 'appliance-repair', 'Washers, fridges, ovens and more'],
  ['Interior Design', 'interior-design', 'Space planning and styling'],
  ['Automotive Repair', 'automotive-repair', 'Car servicing, brakes and diagnostics'],
];
export const CATEGORIES = CAT.map(([name, slug, description], i) => ({
  id: u(1000 + i), name, slug, description, sortOrder: i,
}));

export const ADMIN = { id: u(1), email: 'admin@serviceconnect.example.com', name: 'Ananya Deshmukh' };
export const CUSTOMERS = [
  { id: u(10), email: 'aarav@example.com', name: 'Aarav Kulkarni', phone: '+91-98220-11001' },
  { id: u(11), email: 'diya@example.com', name: 'Diya Menon', phone: '+91-94470-11002' },
];

export type SeedStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface SeedProvider {
  /** user/profile id → u(n) */
  n: number;
  email: string;
  owner: string;
  business: string;
  /** index into CATEGORIES */
  category: number;
  city: string;
  /** Nearby towns the provider will travel to. Drives the public "service areas". */
  areas: string[];
  status: SeedStatus;
  rate: string;
}

/**
 * 11 fictional providers: 8 APPROVED (public) + PENDING/REJECTED/SUSPENDED.
 *
 * Indian market (Goa) fixtures: Konkani/Goan business names, real city names,
 * and prices in rupees on a scale that matches the market — a plumbing call-out
 * runs into the thousands, a full home repaint into the tens of thousands.
 *
 * `rate` is the provider's advertised starting rate, NOT an hourly figure; the
 * UI labels it "from". Every price is a plain numeric string, exactly as
 * PostgreSQL returns NUMERIC: no currency symbol is stored anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO SEEDED SERVICES (Phase 21).
 *
 * This fixture set used to carry a `services: [title, price][]` array per
 * provider, and seed.ts inserted one row per entry. Those were demonstration
 * rows invented by the project, never approved by a real user, and they
 * outnumbered the services real providers had actually created — so the public
 * directory was mostly fiction. They have been removed.
 *
 * The providers themselves are KEPT on purpose. They are the fixture that gives
 * the "only APPROVED is public" rule something to be tested against
 * (search.test.ts, profile.test.ts, bookings.test.ts all read the seeded
 * directory). A provider with no services is a legitimate, everyday state — it
 * is what every brand-new provider looks like before they publish anything.
 *
 * Services are now created only by real providers through the API, or by a test
 * that provisions its own fixture.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const PROVIDERS: SeedProvider[] = [
  { n: 100, email: 'contact@ganpatiacqua.example.com', owner: 'Rajesh Naik', business: 'Ganpati Aqua Plumbing', category: 0, city: 'Panaji', areas: ['Panaji', 'Panjim', 'Dona Paula'], status: 'APPROVED', rate: '7500.00' },
  { n: 101, email: 'contact@voltwright.example.com', owner: 'Priya Kamat', business: 'VoltRight Electrical Works', category: 1, city: 'Mapusa', areas: ['Mapusa', 'Sichim', 'Assemode'], status: 'APPROVED', rate: '9000.00' },
  { n: 102, email: 'contact@teakcraft.example.com', owner: 'Sunil Pawar', business: 'TeakCraft Carpentry', category: 2, city: 'Margao', areas: ['Margao', 'Cavelossim', 'Madgaon'], status: 'APPROVED', rate: '12000.00' },
  { n: 103, email: 'contact@brightcoat.example.com', owner: 'Farhan Khan', business: 'BrightCoat Painters', category: 3, city: 'Ponda', areas: ['Ponda', 'Vodlem', 'Borim'], status: 'APPROVED', rate: '15000.00' },
  { n: 104, email: 'contact@sparklehive.example.com', owner: 'Meera Fernandes', business: 'SparkleHive Home Cleaning', category: 4, city: 'Porvorim', areas: ['Porvorim', 'Saligao', 'Arpora'], status: 'APPROVED', rate: '3000.00' },
  { n: 105, email: 'contact@servicekart.example.com', owner: 'Rohit Shirodkar', business: 'ServiceKart Appliance Care', category: 5, city: 'Vasco da Gama', areas: ['Vasco da Gama', 'Dabolim', 'Mormugao'], status: 'APPROVED', rate: '7500.00' },
  { n: 106, email: 'contact@nestcraft.example.com', owner: 'Anjali Prabhu', business: 'NestCraft Interiors', category: 6, city: 'Panaji', areas: ['Panaji', 'Panjim', 'Old Goa'], status: 'APPROVED', rate: '15000.00' },
  { n: 107, email: 'contact@garagegoa.example.com', owner: 'Vikram Sawant', business: 'Goa Garage Motors', category: 7, city: 'Mapusa', areas: ['Mapusa', 'Aldona', 'Bicholim'], status: 'APPROVED', rate: '10000.00' },
  { n: 108, email: 'contact@quickpatch.example.com', owner: 'Sandeep Naik', business: 'QuickPatch Plumbing', category: 0, city: 'Margao', areas: ['Margao', 'Curtorim'], status: 'PENDING', rate: '6000.00' },
  { n: 109, email: 'contact@shadowvolt.example.com', owner: 'Kunal Raikar', business: 'ShadowVolt Services', category: 1, city: 'Ponda', areas: ['Ponda', 'Satari'], status: 'REJECTED', rate: '8000.00' },
  { n: 110, email: 'contact@pureshine.example.com', owner: 'Nikhil Patil', business: 'PureShine Office Cleaning', category: 4, city: 'Porvorim', areas: ['Porvorim', 'Candolim'], status: 'SUSPENDED', rate: '4000.00' },
];

// --- bookings and reviews: REMOVED (Phase 21) ---------------------------
//
// Both fixture sets used to live here and have been deleted.
//
// They are not independent of the seeded services: `bookings.service_id`
// REFERENCES services(id) ON DELETE RESTRICT, so a booking cannot outlive the
// service it was booked against. Every seeded booking pointed at a seeded
// service (u(1000), u(1010), …), and every seeded review pointed at one of
// those bookings via `reviews.booking_id … ON DELETE CASCADE`.
//
// That makes them the same category of row as the services themselves: content
// invented by the project and never approved by a real user. Leaving them would
// have meant either keeping the dummy services (the thing being removed) or
// orphaning bookings, which the schema correctly forbids.
//
// Bookings and reviews are now created only by real activity through the API.
// Tests that need them provision their own fixture in `before()` rather than
// relying on the database arriving pre-populated.

// --- admin decisions: reference providers only, so they are unaffected ---

/** [id, targetProvider, previous, new, note] */
export const ADMIN_LOGS: [number, number, string, string, string][] = [
  [6000, 100, 'PENDING', 'APPROVED', 'License & insurance verified'],
  [6001, 109, 'PENDING', 'REJECTED', 'Missing trade certification'],
  [6002, 110, 'APPROVED', 'SUSPENDED', 'Repeated customer complaints'],
];
