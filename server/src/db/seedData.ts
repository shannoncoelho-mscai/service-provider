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

export const ADMIN = { id: u(1), email: 'admin@serviceconnect.example.com', name: 'Avery Stone' };
export const CUSTOMERS = [
  { id: u(10), email: 'ava.reynolds@example.com', name: 'Ava Reynolds', phone: '+1-512-555-0101' },
  { id: u(11), email: 'ben.carter@example.com', name: 'Ben Carter', phone: '+1-214-555-0102' },
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
  status: SeedStatus;
  rate: string;
  services: [title: string, price: string][];
}

/** 11 fictional providers: 8 APPROVED (public) + PENDING/REJECTED/SUSPENDED. */
export const PROVIDERS: SeedProvider[] = [
  { n: 100, email: 'contact@aquafix.example.com', owner: 'Marcus Rivera', business: 'AquaFix Plumbing Co.', category: 0, city: 'Austin', status: 'APPROVED', rate: '95.00',
    services: [['Emergency pipe repair', '120.00'], ['Drain unclogging', '90.00']] },
  { n: 101, email: 'contact@voltwright.example.com', owner: 'Priya Nair', business: 'VoltRight Electrical', category: 1, city: 'Dallas', status: 'APPROVED', rate: '110.00',
    services: [['Electrical panel inspection', '150.00'], ['Outlet installation', '80.00']] },
  { n: 102, email: 'contact@hammerhead.example.com', owner: 'Tom Becker', business: 'Hammerhead Carpentry', category: 2, city: 'Houston', status: 'APPROVED', rate: '85.00',
    services: [['Custom shelving build', '350.00'], ['Door installation', '140.00']] },
  { n: 103, email: 'contact@brightcoat.example.com', owner: 'Elena Duarte', business: 'BrightCoat Painting', category: 3, city: 'San Antonio', status: 'APPROVED', rate: '70.00',
    services: [['Interior room repaint', '400.00'], ['Exterior trim painting', '260.00']] },
  { n: 104, email: 'contact@sparklehive.example.com', owner: 'Grace Kim', business: 'SparkleHive Cleaning', category: 4, city: 'Austin', status: 'APPROVED', rate: '45.00',
    services: [['Deep clean (3 bed)', '220.00'], ['Move-out cleaning', '180.00']] },
  { n: 105, email: 'contact@gadgetdocs.example.com', owner: 'Owen Patel', business: 'GadgetDocs Appliance Repair', category: 5, city: 'Dallas', status: 'APPROVED', rate: '90.00',
    services: [['Washer diagnosis', '95.00'], ['Refrigerator repair', '130.00']] },
  { n: 106, email: 'contact@nestcraft.example.com', owner: 'Sofia Lindqvist', business: 'NestCraft Interiors', category: 6, city: 'Houston', status: 'APPROVED', rate: '120.00',
    services: [['Room redesign consultation', '200.00'], ['Full-home staging', '900.00']] },
  { n: 107, email: 'contact@torqueauto.example.com', owner: 'Dmitri Volkov', business: 'TorqueAuto Motors', category: 7, city: 'San Antonio', status: 'APPROVED', rate: '100.00',
    services: [['Brake service', '280.00'], ['Engine diagnostics', '110.00']] },
  { n: 108, email: 'contact@quickpatch.example.com', owner: 'Ana Souza', business: 'QuickPatch Plumbing', category: 0, city: 'Austin', status: 'PENDING', rate: '80.00',
    services: [['Leak patching', '70.00']] },
  { n: 109, email: 'contact@shadowvolt.example.com', owner: 'Kyle Mercer', business: 'ShadowVolt Services', category: 1, city: 'Dallas', status: 'REJECTED', rate: '75.00',
    services: [['Wiring upgrade', '300.00']] },
  { n: 110, email: 'contact@pureshine.example.com', owner: 'Nadia Haddad', business: 'PureShine Office Cleaning', category: 4, city: 'Houston', status: 'SUSPENDED', rate: '55.00',
    services: [['Office cleaning (per visit)', '260.00']] },
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
