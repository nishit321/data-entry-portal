/* eslint-disable no-console -- a command-line tool reports by printing */
import { PrismaClient, ReferenceCategory, Role } from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';

/**
 * The parts of the seed a **real** deployment needs.
 *
 * Split out from `seed.ts` on 16 September 2026, because that file did two unrelated jobs under one
 * command: it created the administrator and the lookup lists a live portal cannot work without,
 * and in the same breath it invented an operator, a questionnaire, four quarters of approved
 * returns, 250 agents and a suspended licence.
 *
 * Running it on production therefore meant creating a demonstration and then deleting it by hand,
 * on a live server, one screen at a time. The safest deletion is the one nobody has to make, so
 * these two functions live here and `seed-production.ts` runs only them.
 *
 * Both are idempotent and non-destructive. Running them twice changes nothing, and neither
 * overwrites a value somebody has edited.
 */

export const prisma = new PrismaClient();

/** Create the initial ADMIN account if it does not exist. */
export async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@nca.gov.ss').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';

  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`Admin already exists: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: 'System',
      lastName: 'Administrator',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log('Seeded admin account:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('  (change this password after first login)');
}

/**
 * Seed the managed lookup lists from the questionnaire's controlled fields.
 * Idempotent and non-destructive: existing rows (incl. admin edits) are left
 * untouched. "Other" is handled as a controlled free-text pair, not seeded here.
 */
export async function seedReferenceData() {
  const lists: Record<ReferenceCategory, { code: string; label: string }[]> = {
    SPECTRUM_BAND: [
      { code: 'MHZ_700', label: '700 MHz' },
      { code: 'MHZ_800', label: '800 MHz' },
      { code: 'MHZ_900', label: '900 MHz' },
      { code: 'MHZ_1800', label: '1800 MHz' },
      { code: 'MHZ_2100', label: '2100 MHz' },
      { code: 'MHZ_2600', label: '2600 MHz' },
      { code: 'MHZ_3500', label: '3500 MHz' },
    ],
    TECHNOLOGY: [
      { code: '2G', label: '2G' },
      { code: '3G', label: '3G' },
      { code: '4G', label: '4G' },
      { code: '5G', label: '5G' },
      { code: 'FIBER', label: 'Fibre' },
      { code: 'WIRELESS_BROADBAND', label: 'Wireless Broadband' },
      { code: 'MICROWAVE', label: 'Microwave' },
      { code: 'VSAT', label: 'VSAT' },
    ],
    SERVICE_TYPE: [
      { code: 'MOBILE_VOICE', label: 'Mobile Voice' },
      { code: 'MOBILE_DATA', label: 'Mobile Data' },
      { code: 'MOBILE_MONEY', label: 'Mobile Money Services' },
      { code: 'FIXED_INTERNET', label: 'Fixed Internet' },
      { code: 'VAS', label: 'Value-Added Services (VAS)' },
    ],
    GEO_CLASSIFICATION: [
      { code: 'URBAN', label: 'Urban' },
      { code: 'PERI_URBAN', label: 'Peri-urban' },
      { code: 'RURAL', label: 'Rural' },
    ],
    ENERGY_GENERATION_TYPE: [
      { code: 'DIESEL', label: 'Diesel' },
      { code: 'WIND', label: 'Wind' },
      { code: 'SOLAR', label: 'Solar' },
      { code: 'HYBRID', label: 'Hybrid' },
    ],
    ENERGY_STORAGE_TYPE: [
      { code: 'LITHIUM_ION', label: 'Lithium-ion storage' },
      { code: 'OTHER_CHEMICAL', label: 'Other chemical storage' },
      { code: 'CAPACITIVE', label: 'Capacitive storage' },
    ],
    FIXED_ACCESS_TYPE: [
      { code: 'DSL', label: 'DSL' },
      { code: 'FIBER', label: 'Fibre' },
      { code: 'SATELLITE_LEO', label: 'Satellite (LEO)' },
      { code: 'SATELLITE_GEO', label: 'Satellite (geostationary)' },
      { code: 'WIRELESS_BROADBAND', label: 'Wireless Broadband' },
    ],
    TRANSACTION_TYPE: [
      { code: 'CASH_IN', label: 'Cash-in' },
      { code: 'CASH_OUT', label: 'Cash-out' },
      { code: 'P2P', label: 'Peer-to-peer (P2P) transfers' },
      { code: 'MERCHANT_PAYMENT', label: 'Merchant payments' },
      { code: 'BILL_PAYMENT', label: 'Bill payments' },
      { code: 'BULK_DISBURSEMENT', label: 'Bulk disbursements' },
      { code: 'CROSS_NETWORK', label: 'Cross-network (interoperable)' },
    ],
  };

  let count = 0;
  for (const [category, items] of Object.entries(lists) as [
    ReferenceCategory,
    { code: string; label: string }[],
  ][]) {
    for (let i = 0; i < items.length; i++) {
      await prisma.referenceItem.upsert({
        where: { category_code: { category, code: items[i].code } },
        update: {},
        create: { category, code: items[i].code, label: items[i].label, sortOrder: i },
      });
      count++;
    }
  }
  console.log(
    `Seeded reference data (${count} items across ${Object.keys(lists).length} categories).`,
  );
}
