import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '../src/lib/xbarPhaseTwo.js';
import { rankHorseMatches } from '../src/lib/xbarRuntime.js';
import type { DocumentRecord, HorseRecord, OwnershipRecord } from '../src/types/xbar.js';

/*
 * Fixture dates that mean "recent" have to be derived from today.
 *
 * Document currency is measured against the real clock -- health support is
 * current for CURRENT_HEALTH_SUPPORT_DAYS (180) and Coggins for
 * CURRENT_COGGINS_DAYS (365). A hardcoded date therefore ages out on its own:
 * the health note below was written as 2026-03-08, which stopped being current
 * on 2026-09-04, and this suite began failing the next morning with nobody
 * having touched the code. Dates that encode an INTENT ("current", "long
 * expired") are expressed as that intent instead of as a literal.
 */
function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function createHorse(
  overrides: Partial<HorseRecord> &
    Pick<
      HorseRecord,
      'id' | 'name' | 'barnName' | 'owner' | 'ownerEntity' | 'aqhaNumber' | 'registrationNumber' | 'registered'
    >,
): HorseRecord {
  const { id, name, barnName, owner, ownerEntity, aqhaNumber, registrationNumber, registered, ...rest } = overrides;
  return {
    id,
    name,
    barnName,
    summary: 'Fixture horse',
    segment: 'Sale Prospect',
    status: 'Sale Prep',
    breed: 'Quarter Horse',
    registry: 'AQHA',
    aqhaNumber,
    registrationNumber,
    registered,
    age: 8,
    foaledOn: '2018-03-11',
    sex: 'Mare',
    color: 'Sorrel',
    markings: 'Star',
    microchipId: '981020003811245',
    owner,
    ownerEntity,
    insuredValue: 100000,
    profileImage: '/fixture.png',
    tags: [],
    bloodline: {
      sire: 'Fixture sire',
      dam: 'Fixture dam',
      family: 'Fixture family',
    },
    location: {
      ranch: 'Fixture ranch',
      barn: 'Fixture barn',
      pasture: 'Fixture pasture',
      stall: 'Fixture stall',
    },
    assignments: {
      trainer: 'Trainer',
      ranchManager: 'Manager',
      veterinarian: 'Dr. Vet',
      farrier: 'Farrier',
    },
    ownership: [],
    gallery: [],
    sale: {
      listingState: 'Market Ready',
      askPrice: 100000,
      buyerConfidence: 80,
      inquiryCount: 2,
      watchlistCount: 1,
      socialReady: true,
    },
    readiness: {
      score: 80,
      blockers: [],
      packetStatus: 'Ready',
    },
    medicalNotes: 'Fixture medical notes',
    lastVetVisit: '2026-03-20',
    documents: [],
    medicalTimeline: [],
    breedingTimeline: [],
    activity: [],
    documentFacts: [],
    alerts: [],
    notes: [],
    ...rest,
  };
}

function createDocument(
  overrides: Partial<DocumentRecord> & Pick<DocumentRecord, 'id' | 'title' | 'type'>,
): DocumentRecord {
  const { id, title, type, ...rest } = overrides;
  return {
    id,
    title,
    type,
    horseId: undefined,
    uploadedBy: 'Ops Desk',
    uploadedAt: '2026-03-25',
    source: 'Bulk Intake',
    state: 'Ready',
    confidence: 0.96,
    duplicateRisk: 'Low',
    extractedTextPreview: 'Fixture preview',
    summary: 'Fixture summary',
    entities: {},
    ...rest,
  };
}

const horsesSeed: HorseRecord[] = [
  createHorse({
    id: 'horse-wiggy',
    name: 'WIGGY N RED',
    barnName: 'Wiggy',
    owner: 'Erin Wyrick',
    ownerEntity: 'XBAR LLC',
    aqhaNumber: 'AQHA 6128841',
    registrationNumber: 'WGY-RED-2018',
    registered: true,
    gallery: [
      { id: 'hero-wiggy', label: 'Hero', kind: 'Hero', url: '/hero.png', status: 'Approved' },
      { id: 'sale-wiggy', label: 'Sale', kind: 'Sale Still', url: '/sale.png', status: 'Approved' },
    ],
    sale: {
      listingState: 'Market Ready',
      askPrice: 148000,
      buyerConfidence: 91,
      inquiryCount: 11,
      watchlistCount: 6,
      socialReady: true,
    },
  }),
  createHorse({
    id: 'horse-dolly',
    name: 'RT BLUE DOLLY 1321',
    barnName: 'Dolly',
    owner: 'Jason Wyrick',
    ownerEntity: 'Blue Line Partners',
    aqhaNumber: 'AQHA 5988212',
    registrationNumber: 'RTBD-2017',
    registered: false,
    alerts: [
      {
        id: 'alert-dolly-1',
        title: 'Transfer review open',
        summary: 'AQHA review still open.',
        severity: 'high',
        module: 'Ownership',
      },
    ],
    gallery: [{ id: 'hero-dolly', label: 'Hero', kind: 'Hero', url: '/hero.png', status: 'Approved' }],
    sale: {
      listingState: 'Buyer Review',
      askPrice: 132000,
      buyerConfidence: 84,
      inquiryCount: 7,
      watchlistCount: 4,
      socialReady: true,
    },
  }),
];

const documentsSeed: DocumentRecord[] = [
  createDocument({
    id: 'doc-wiggy-reg',
    title: 'Wiggy AQHA certificate refresh',
    type: 'Registration',
    horseId: 'horse-wiggy',
    entities: {
      horseName: 'WIGGY N RED',
      registrationNumber: 'WGY-RED-2018',
      ownerName: 'Erin Wyrick',
    },
  }),
  createDocument({
    id: 'doc-wiggy-vet',
    title: 'Wiggy March soundness note',
    type: 'Vet Record',
    horseId: 'horse-wiggy',
    entities: {
      horseName: 'WIGGY N RED',
      examDate: daysAgo(30),
      veterinarian: 'Dr. Maya Brant',
    },
  }),
  createDocument({
    id: 'doc-wiggy-media',
    title: 'Wiggy sale media packet',
    type: 'Media Kit',
    horseId: 'horse-wiggy',
    entities: {
      horseName: 'WIGGY N RED',
    },
  }),
  createDocument({
    id: 'doc-bonny-transfer',
    title: 'Bonny travel packet signature page',
    type: 'Transfer Packet',
    horseId: 'horse-bonny',
    state: 'Needs Review',
    confidence: 0.74,
    duplicateRisk: 'Possible Duplicate',
    entities: {
      horseName: 'BONNY LIL MAN ROGERS',
      transferStatus: 'Pending Signatures',
    },
  }),
  createDocument({
    id: 'doc-dolly-transfer',
    title: 'Dolly AQHA transfer packet',
    type: 'Transfer Packet',
    horseId: 'horse-dolly',
    state: 'Needs Review',
    confidence: 0.87,
    entities: {
      horseName: 'RT BLUE DOLLY 1321',
      transferStatus: 'AQHA Review',
    },
  }),
  createDocument({
    id: 'doc-dolly-sale',
    title: 'Dolly private buyer packet',
    type: 'Media Kit',
    horseId: 'horse-dolly',
    entities: {
      horseName: 'RT BLUE DOLLY 1321',
    },
  }),
];

const ownershipSeed: OwnershipRecord[] = [
  {
    id: 'ownership-wiggy',
    horseId: 'horse-wiggy',
    legalOwner: 'Erin Wyrick',
    transferStatus: 'Clear',
    pendingDocuments: [],
    complianceDeadline: '2026-04-30',
    confidence: 98,
    auditTrail: [],
  },
  {
    id: 'ownership-dolly',
    horseId: 'horse-dolly',
    legalOwner: 'Jason Wyrick',
    transferStatus: 'AQHA Review',
    pendingDocuments: ['AQHA transfer clearance'],
    complianceDeadline: '2026-03-29',
    confidence: 81,
    auditTrail: [],
  },
];

test('rankHorseMatches prefers exact registry evidence', () => {
  const [match] = rankHorseMatches(horsesSeed, 'AQHA certificate WGY-RED-2018 owner Erin Wyrick');
  assert.equal(match?.horse.id, 'horse-wiggy');
  assert.ok((match?.confidence ?? 0) >= 0.95);
});

test('buildDocumentTrustProfile keeps duplicate-risk documents out of buyer packet use', () => {
  const document = documentsSeed.find((entry) => entry.id === 'doc-bonny-transfer');
  assert.ok(document);

  const trust = buildDocumentTrustProfile(document, horsesSeed);
  assert.equal(trust.readyForProfile, false);
  assert.ok(trust.reviewReasons.some((reason) => reason.toLowerCase().includes('duplicate')));
  assert.ok(trust.trustScore < 80);
});

test('buildHorsePacketCompleteness reflects live and blocked buyer profile states', () => {
  const wiggy = horsesSeed.find((entry) => entry.id === 'horse-wiggy');
  const dolly = horsesSeed.find((entry) => entry.id === 'horse-dolly');
  assert.ok(wiggy);
  assert.ok(dolly);

  const wiggyPacket = buildHorsePacketCompleteness(
    wiggy,
    documentsSeed.filter((document) => document.horseId === wiggy.id),
    ownershipSeed.find((record) => record.horseId === wiggy.id),
  );
  assert.equal(wiggyPacket.buyerProfileStatus, 'Needs Review');
  assert.equal(wiggyPacket.sharePath, '/profiles/horse-wiggy');
  assert.ok(wiggyPacket.score >= 80);
  assert.equal(wiggyPacket.saleSlots.find((slot) => slot.key === 'aqha-papers')?.status, 'ready');
  assert.equal(wiggyPacket.saleSlots.find((slot) => slot.key === 'health-cert')?.status, 'ready');
  assert.equal(wiggyPacket.saleSlots.find((slot) => slot.key === 'aqha-photos')?.status, 'ready');

  const dollyPacket = buildHorsePacketCompleteness(
    dolly,
    documentsSeed.filter((document) => document.horseId === dolly.id),
    ownershipSeed.find((record) => record.horseId === dolly.id),
  );
  assert.equal(dollyPacket.buyerProfileStatus, 'Blocked');
  assert.equal(dollyPacket.buyerSafe, false);
  assert.equal(dollyPacket.saleSlots.find((slot) => slot.key === 'coggins')?.status, 'missing');
  assert.equal(dollyPacket.saleSlots.find((slot) => slot.key === 'transfer-papers')?.status, 'review');
});

test('buildHorsePacketCompleteness requires current dated Coggins evidence', () => {
  const wiggy = horsesSeed.find((entry) => entry.id === 'horse-wiggy');
  assert.ok(wiggy);

  const undatedPacket = buildHorsePacketCompleteness(wiggy, [
    createDocument({
      id: 'doc-undated-coggins',
      title: 'Undated Coggins',
      type: 'Coggins',
      horseId: wiggy.id,
      entities: {
        horseName: wiggy.name,
      },
    }),
  ]);
  assert.equal(undatedPacket.saleSlots.find((slot) => slot.key === 'coggins')?.status, 'review');

  const expiredPacket = buildHorsePacketCompleteness(wiggy, [
    createDocument({
      id: 'doc-expired-coggins',
      title: 'Expired Coggins',
      type: 'Coggins',
      horseId: wiggy.id,
      entities: {
        horseName: wiggy.name,
        examDate: daysAgo(3 * 365),
      },
    }),
  ]);
  assert.equal(expiredPacket.saleSlots.find((slot) => slot.key === 'coggins')?.status, 'review');

  const currentPacket = buildHorsePacketCompleteness(wiggy, [
    createDocument({
      id: 'doc-current-coggins',
      title: 'Current Coggins',
      type: 'Coggins',
      horseId: wiggy.id,
      entities: {
        horseName: wiggy.name,
        examDate: daysAgo(60),
      },
    }),
  ]);
  assert.equal(currentPacket.saleSlots.find((slot) => slot.key === 'coggins')?.status, 'ready');
});
