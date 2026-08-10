import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 5 Users
  const owner = await prisma.user.upsert({
    where: { clerkId: 'user_test_owner' },
    update: {},
    create: {
      clerkId: 'user_test_owner',
      email: 'owner@charcoal.com',
      name: 'Test Owner',
      role: Role.owner,
    },
  });

  const accountant = await prisma.user.upsert({
    where: { clerkId: 'user_test_accountant' },
    update: {},
    create: {
      clerkId: 'user_test_accountant',
      email: 'accountant@charcoal.com',
      name: 'Test Accountant',
      role: Role.accountant,
    },
  });

  const salesRep = await prisma.user.upsert({
    where: { clerkId: 'user_test_sales' },
    update: {},
    create: {
      clerkId: 'user_test_sales',
      email: 'sales@charcoal.com',
      name: 'Test Sales Rep',
      role: Role.sales_rep,
    },
  });

  const worker = await prisma.user.upsert({
    where: { clerkId: 'user_test_worker' },
    update: {},
    create: {
      clerkId: 'user_test_worker',
      email: 'worker@charcoal.com',
      name: 'Test Worker',
      role: Role.worker,
    },
  });

  const driver = await prisma.user.upsert({
    where: { clerkId: 'user_test_driver' },
    update: {},
    create: {
      clerkId: 'user_test_driver',
      email: 'driver@charcoal.com',
      name: 'Test Driver',
      role: Role.driver,
    },
  });

  console.log(`Seeded users: ${owner.email}, ${accountant.email}, ${salesRep.email}, ${worker.email}, ${driver.email}`);

  // 3 BagTypes
  const bag2kg = await prisma.bagType.upsert({
    where: { id: '00000000-0000-4000-8000-000000002001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000002001',
      name: '2kg Bag',
      nominalKg: '2.000',
      costPerBag: '0.1500',
      workerRate: '0.0500',
    },
  });

  const bag5kg = await prisma.bagType.upsert({
    where: { id: '00000000-0000-4000-8000-000000005001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000005001',
      name: '5kg Bag',
      nominalKg: '5.000',
      costPerBag: '0.2500',
      workerRate: '0.0800',
    },
  });

  const bag10kg = await prisma.bagType.upsert({
    where: { id: '00000000-0000-4000-8000-000000010001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000010001',
      name: '10kg Bag',
      nominalKg: '10.000',
      costPerBag: '0.4000',
      workerRate: '0.1200',
    },
  });

  console.log(`Seeded bag types: ${bag2kg.name}, ${bag5kg.name}, ${bag10kg.name}`);

  // 2 Suppliers
  const supplier1 = await prisma.supplier.upsert({
    where: { id: '00000000-0000-4000-8000-100000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-100000000001',
      name: 'Gulf Charcoal Co.',
      country: 'Saudi Arabia',
      contactPersons: [
        { name: 'Ahmad Khalil', phone: '+966 50 000001', role: 'Sales Manager' },
      ],
      charcoalTypes: [
        { type: 'BBQ hardwood', grade: 'A' },
        { type: 'BBQ hardwood', grade: 'B' },
      ],
      bankDetails: {
        bankName: 'Saudi National Bank',
        accountNumber: 'SA00 0000 0000 0000 0000 0000',
        iban: 'SA00 0000 0000 0000 0000 0000',
        swift: 'NCBKSAJE',
      },
      paymentTerms: 'Net 60',
      leadTimeDays: 45,
    },
  });

  const supplier2 = await prisma.supplier.upsert({
    where: { id: '00000000-0000-4000-8000-100000000002' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-100000000002',
      name: 'Shisha Wood Exports Ltd.',
      country: 'Indonesia',
      contactPersons: [
        { name: 'Budi Santoso', phone: '+62 812 0000001', role: 'Export Manager' },
      ],
      charcoalTypes: [
        { type: 'shisha', grade: 'A' },
        { type: 'shisha', grade: 'B' },
      ],
      paymentTerms: 'Net 30',
      leadTimeDays: 60,
    },
  });

  console.log(`Seeded suppliers: ${supplier1.name}, ${supplier2.name}`);

  // 1 Container linked to supplier1
  const container = await prisma.container.upsert({
    where: { id: '00000000-0000-4000-8000-200000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-200000000001',
      number: 'GCLX-2024-001',
      supplierId: supplier1.id,
      status: 'port',
      createdById: owner.id,
      notes: 'First seed container',
    },
  });

  console.log(`Seeded container: ${container.number}`);

  // 2 ProductLines on that container
  const line1 = await prisma.containerProductLine.upsert({
    where: { id: '00000000-0000-4000-8000-300000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-300000000001',
      containerId: container.id,
      charcoalType: 'BBQ hardwood',
      grade: 'A',
      supplierId: supplier1.id,
      paidBags: 1000,
      giftBags: 50,
      kgPerBag: '10.000',
      pricePerTon: '450.00',
    },
  });

  const line2 = await prisma.containerProductLine.upsert({
    where: { id: '00000000-0000-4000-8000-300000000002' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-300000000002',
      containerId: container.id,
      charcoalType: 'BBQ hardwood',
      grade: 'B',
      supplierId: supplier1.id,
      paidBags: 500,
      giftBags: 0,
      kgPerBag: '10.000',
      pricePerTon: '380.00',
    },
  });

  console.log(`Seeded product lines: ${line1.charcoalType} ${line1.grade}, ${line2.charcoalType} ${line2.grade}`);

  // 1 StockLot linked to supplier1
  const stockLot = await prisma.stockLot.upsert({
    where: { id: '00000000-0000-4000-8000-400000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-400000000001',
      charcoalType: 'BBQ hardwood',
      grade: 'A',
      supplierId: supplier1.id,
      kgReceived: '5000.000',
      kgRemaining: '5000.000',
      costPerKg: '0.4500',
      source: 'direct',
      dateReceived: new Date('2024-01-15'),
      notes: 'Initial seed stock',
    },
  });

  console.log(`Seeded stock lot: ${stockLot.charcoalType} ${stockLot.grade}, kgRemaining=${stockLot.kgRemaining}`);

  // 3 Clients
  const client1 = await prisma.client.upsert({
    where: { id: '00000000-0000-4000-8000-500000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-500000000001',
      name: 'Al Nakheel Restaurant',
      type: 'restaurant',
      currency: 'USD',
      phones: [{ number: '+961 1 000001', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }],
      preferredTypes: [{ charcoalType: 'BBQ hardwood', grade: 'A' }],
      paymentTerms: 'Net 30',
      notes: 'Seed client',
    },
  });

  const client2 = await prisma.client.upsert({
    where: { id: '00000000-0000-4000-8000-500000000002' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-500000000002',
      name: 'Beirut Shisha Lounge',
      type: 'wholesale',
      currency: 'USD',
      phones: [{ number: '+961 3 000002', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }],
      preferredTypes: [{ charcoalType: 'shisha', grade: 'A' }],
      paymentTerms: 'Net 15',
    },
  });

  const client3 = await prisma.client.upsert({
    where: { id: '00000000-0000-4000-8000-500000000003' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-500000000003',
      name: 'Marina Walk Café',
      type: 'restaurant',
      currency: 'USD',
      phones: [{ number: '+961 70 000003', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }],
      preferredTypes: [{ charcoalType: 'BBQ hardwood', grade: 'B' }],
    },
  });

  console.log(`Seeded clients: ${client1.name}, ${client2.name}, ${client3.name}`);

  // 2 Workers
  const worker1 = await prisma.worker.upsert({
    where: { id: '00000000-0000-4000-8000-600000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-600000000001',
      name: 'Hassan Mahmoud',
      phone: '+961 71 100001',
      ratesPerBagType: [
        { bagTypeId: bag2kg.id, ratePerBag: 0.05 },
        { bagTypeId: bag5kg.id, ratePerBag: 0.08 },
        { bagTypeId: bag10kg.id, ratePerBag: 0.12 },
      ],
      totalBagsPacked: [],
      totalEarned: '0.00',
      totalPaid: '0.00',
    },
  });

  const worker2 = await prisma.worker.upsert({
    where: { id: '00000000-0000-4000-8000-600000000002' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-600000000002',
      name: 'Omar Khalil',
      phone: '+961 71 100002',
      ratesPerBagType: [
        { bagTypeId: bag2kg.id, ratePerBag: 0.05 },
        { bagTypeId: bag5kg.id, ratePerBag: 0.08 },
        { bagTypeId: bag10kg.id, ratePerBag: 0.12 },
      ],
      totalBagsPacked: [],
      totalEarned: '0.00',
      totalPaid: '0.00',
    },
  });

  console.log(`Seeded workers: ${worker1.name}, ${worker2.name}`);

  // 1 Order
  const order1 = await prisma.clientOrder.upsert({
    where: { id: '00000000-0000-4000-8000-700000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-700000000001',
      clientId: client1.id,
      charcoalType: 'BBQ hardwood',
      grade: 'A',
      totalKgRequested: '200.000',
      bagTypeId: bag10kg.id,
      pricePerBag: '12.00',
      currency: 'USD',
      status: 'confirmed',
      createdById: owner.id,
      notes: 'Seed order',
    },
  });

  console.log(`Seeded order for ${client1.name}`);

  // 1 Invoice (draft)
  const invoice1 = await prisma.invoice.upsert({
    where: { id: '00000000-0000-4000-8000-800000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-800000000001',
      clientId: client1.id,
      orderId: order1.id,
      lines: [{ bagTypeId: bag10kg.id, bagTypeName: '10kg Bag', qty: 20, pricePerBag: 12, lineTotal: 240 }],
      subtotal: '240.00',
      total: '240.00',
      currency: 'USD',
      status: 'issued',
      paidAmount: '0.00',
      issuedAt: new Date('2026-05-01'),
      dueDate: new Date('2026-05-31'),
    },
  });

  console.log(`Seeded invoice for ${client1.name}`);
  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
