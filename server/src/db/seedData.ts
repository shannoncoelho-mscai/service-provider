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
  /** user/profile id → u(n); services get ids u(n*10+i) */
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
  services: [title: string, price: string][];
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
 */
export const PROVIDERS: SeedProvider[] = [
  { n: 100, email: 'contact@ganpatiacqua.example.com', owner: 'Rajesh Naik', business: 'Ganpati Aqua Plumbing', category: 0, city: 'Panaji', areas: ['Panaji', 'Panjim', 'Dona Paula'], status: 'APPROVED', rate: '7500.00',
    services: [['Emergency pipe repair', '4500.00'], ['Drain unclogging', '2500.00']] },
  { n: 101, email: 'contact@voltwright.example.com', owner: 'Priya Kamat', business: 'VoltRight Electrical Works', category: 1, city: 'Mapusa', areas: ['Mapusa', 'Sichim', 'Assemode'], status: 'APPROVED', rate: '9000.00',
    services: [['Electrical panel inspection', '3500.00'], ['Outlet installation', '1800.00']] },
  { n: 102, email: 'contact@teakcraft.example.com', owner: 'Sunil Pawar', business: 'TeakCraft Carpentry', category: 2, city: 'Margao', areas: ['Margao', 'Cavelossim', 'Madgaon'], status: 'APPROVED', rate: '12000.00',
    services: [['Custom shelving build', '18000.00'], ['Door installation', '9500.00']] },
  { n: 103, email: 'contact@brightcoat.example.com', owner: 'Farhan Khan', business: 'BrightCoat Painters', category: 3, city: 'Ponda', areas: ['Ponda', 'Vodlem', 'Borim'], status: 'APPROVED', rate: '15000.00',
    services: [['Interior room repaint', '24000.00'], ['Exterior trim painting', '16000.00']] },
  { n: 104, email: 'contact@sparklehive.example.com', owner: 'Meera Fernandes', business: 'SparkleHive Home Cleaning', category: 4, city: 'Porvorim', areas: ['Porvorim', 'Saligao', 'Arpora'], status: 'APPROVED', rate: '3000.00',
    services: [['Deep clean (3 bed)', '6500.00'], ['Move-out cleaning', '8000.00']] },
  { n: 105, email: 'contact@servicekart.example.com', owner: 'Rohit Shirodkar', business: 'ServiceKart Appliance Care', category: 5, city: 'Vasco da Gama', areas: ['Vasco da Gama', 'Dabolim', 'Mormugao'], status: 'APPROVED', rate: '7500.00',
    services: [['Washing machine diagnosis', '2000.00'], ['Refrigerator repair', '2800.00']] },
  { n: 106, email: 'contact@nestcraft.example.com', owner: 'Anjali Prabhu', business: 'NestCraft Interiors', category: 6, city: 'Panaji', areas: ['Panaji', 'Panjim', 'Old Goa'], status: 'APPROVED', rate: '15000.00',
    services: [['Room redesign consultation', '5000.00'], ['Full-home staging', '85000.00']] },
  { n: 107, email: 'contact@garagegoa.example.com', owner: 'Vikram Sawant', business: 'Goa Garage Motors', category: 7, city: 'Mapusa', areas: ['Mapusa', 'Aldona', 'Bicholim'], status: 'APPROVED', rate: '10000.00',
    services: [['Brake service', '5500.00'], ['Engine diagnostics', '3500.00']] },
  { n: 108, email: 'contact@quickpatch.example.com', owner: 'Sandeep Naik', business: 'QuickPatch Plumbing', category: 0, city: 'Margao', areas: ['Margao', 'Curtorim'], status: 'PENDING', rate: '6000.00',
    services: [['Leak patching', '1500.00']] },
  { n: 109, email: 'contact@shadowvolt.example.com', owner: 'Kunal Raikar', business: 'ShadowVolt Services', category: 1, city: 'Ponda', areas: ['Ponda', 'Satari'], status: 'REJECTED', rate: '8000.00',
    services: [['Wiring upgrade', '22000.00']] },
  { n: 110, email: 'contact@pureshine.example.com', owner: 'Nikhil Patil', business: 'PureShine Office Cleaning', category: 4, city: 'Porvorim', areas: ['Porvorim', 'Candolim'], status: 'SUSPENDED', rate: '4000.00',
    services: [['Office cleaning (per visit)', '12000.00']] },
];

// --- bookings: covers all six statuses; scheduled = day offset from today --
export interface SeedBooking {
  id: number; customer: number; provider: number; service: number;
  status: string; scheduled: number; cancellation?: string; rejection?: string;
}
export const BOOKINGS: SeedBooking[] = [
  { id: 4000, customer: 10, provider: 100, service: 1000, status: 'COMPLETED', scheduled: -10 },
  { id: 4001, customer: 10, provider: 101, service: 1010, status: 'ACCEPTED', scheduled: 3 },
  { id: 4002, customer: 11, provider: 100, service: 1001, status: 'PENDING', scheduled: 2 },
  { id: 4003, customer: 11, provider: 102, service: 1020, status: 'CANCELLED', scheduled: 5,
    cancellation: 'Schedule conflict — rebooked later' },
  { id: 4004, customer: 10, provider: 103, service: 1030, status: 'IN_PROGRESS', scheduled: -1 },
  { id: 4005, customer: 11, provider: 104, service: 1040, status: 'COMPLETED', scheduled: -5 },
  { id: 4006, customer: 11, provider: 105, service: 1051, status: 'REJECTED', scheduled: 4,
    rejection: 'Part unavailable this week' },
];

/** [id, booking, customer, provider, rating, comment] — composite FKs match. */
export const REVIEWS: [number, number, number, number, number, string][] = [
  [5000, 4000, 10, 100, 5, 'Fast, tidy and explained everything. Highly recommended.'],
  [5001, 4005, 11, 104, 4, 'Spotless result, arrived right on time.'],
];

/** [id, targetProvider, previous, new, note] */
export const ADMIN_LOGS: [number, number, string, string, string][] = [
  [6000, 100, 'PENDING', 'APPROVED', 'License & insurance verified'],
  [6001, 109, 'PENDING', 'REJECTED', 'Missing trade certification'],
  [6002, 110, 'APPROVED', 'SUSPENDED', 'Repeated customer complaints'],
];
