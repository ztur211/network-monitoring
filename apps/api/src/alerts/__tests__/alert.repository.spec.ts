import { Test } from '@nestjs/testing';
import { AlertRepository } from '../alert.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService, CRYPTO_KEY } from '../../common/crypto/crypto.service';

/**
 * Integration test (real test DB :5433). Named `.repository.spec.ts` so it runs under
 * jest.integration.config (and is excluded from the unit suite). Mirrors the
 * snmp.service.repository.spec.ts harness: DI via Test.createTestingModule with an
 * explicit CRYPTO_KEY provider, rather than constructing services with `new`.
 */
describe('AlertRepository (integration)', () => {
  let prisma: PrismaService;
  let crypto: CryptoService;
  let repo: AlertRepository;
  let orgId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        AlertRepository,
        PrismaService,
        CryptoService,
        { provide: CRYPTO_KEY, useValue: Buffer.alloc(32, 7) },
      ],
    }).compile();
    repo = ref.get(AlertRepository);
    prisma = ref.get(PrismaService);
    crypto = ref.get(CryptoService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `Alerts${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;
  });
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('creates + lists a webhook channel and does NOT return the secret', async () => {
    const ch = await repo.createChannel(orgId, {
      type: 'WEBHOOK',
      name: 'slack',
      enabled: true,
      config: { url: 'https://hooks.example/x' },
      secret: 'topsecret',
    });
    expect((ch as { secretEnc?: unknown }).secretEnc).toBeUndefined(); // repo returns a redacted view

    const list = await repo.listChannels(orgId);
    expect(list.map((c) => c.name)).toContain('slack');

    // the encrypted secret round-trips at point-of-use
    const full = await repo.channelsByIds([ch.id]);
    expect(crypto.decrypt(full[0].secretEnc!)).toBe('topsecret');
  });

  it('getChannel and deleteChannel are org-scoped', async () => {
    const ch = await repo.createChannel(orgId, { type: 'EMAIL', name: 'ops-email', config: {} });
    expect(await repo.getChannel(orgId, ch.id)).not.toBeNull();

    const otherOrg = await prisma.organization.create({ data: { name: `Other${Date.now()}` } });
    try {
      expect(await repo.getChannel(otherOrg.id, ch.id)).toBeNull();
      await repo.deleteChannel(otherOrg.id, ch.id); // no-op: wrong org
      expect(await repo.getChannel(orgId, ch.id)).not.toBeNull();

      await repo.deleteChannel(orgId, ch.id);
      expect(await repo.getChannel(orgId, ch.id)).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });

  it('creates a rule and finds it by trigger', async () => {
    const rule = await repo.createRule(orgId, {
      name: 'core down',
      trigger: 'STATE_TRANSITION',
      scope: { all: true },
      targetStates: ['DOWN'],
      severity: 'CRITICAL',
      channelIds: [],
      cooldownSeconds: 60,
      notifyOnRecovery: true,
    });

    const enabled = await repo.enabledRules(orgId, 'STATE_TRANSITION');
    expect(enabled.map((r) => r.id)).toContain(rule.id);

    const allEnabled = await repo.allEnabledRules('STATE_TRANSITION');
    expect(allEnabled.map((r) => r.id)).toContain(rule.id);

    expect(await repo.enabledRules(orgId, 'METRIC_THRESHOLD')).toHaveLength(0);

    const fetched = await repo.getRule(orgId, rule.id);
    expect(fetched?.name).toBe('core down');

    await repo.updateRule(orgId, rule.id, { enabled: false });
    expect(await repo.enabledRules(orgId, 'STATE_TRANSITION')).toHaveLength(0);

    await repo.deleteRule(orgId, rule.id);
    expect(await repo.getRule(orgId, rule.id)).toBeNull();
  });

  // I2: `{all: false}` must resolve to NO devices (mirrors scopeCovers in
  // alert-evaluator.service.ts, which only treats `scope.all === true` as "covers everything").
  // Before the fix, `'all' in scope` alone returned null ("all devices in org") for ANY object
  // carrying an `all` key, regardless of its value — a per-org over-fire bug.
  it('resolves {all:false} to [] (no devices), and {all:true} to null (no filter = all devices)', async () => {
    expect(await repo.deviceIdsForScope(orgId, { all: false } as never)).toEqual([]);
    expect(await repo.deviceIdsForScope(orgId, { all: true })).toBeNull();
  });

  it('lists rules for an org', async () => {
    await repo.createRule(orgId, {
      name: 'rule-a',
      trigger: 'METRIC_THRESHOLD',
      scope: { all: true },
      severity: 'WARNING',
      channelIds: [],
      cooldownSeconds: 120,
      notifyOnRecovery: false,
    });
    const list = await repo.listRules(orgId);
    expect(list.map((r) => r.name)).toContain('rule-a');
  });

  it('creates events, finds the latest one, and lists them', async () => {
    const rule = await repo.createRule(orgId, {
      name: 'evt-rule',
      trigger: 'STATE_TRANSITION',
      scope: { all: true },
      severity: 'WARNING',
      channelIds: [],
      cooldownSeconds: 60,
      notifyOnRecovery: true,
    });

    await repo.createEvent({
      organizationId: orgId,
      ruleId: rule.id,
      deviceId: null,
      kind: 'FIRING',
      severity: 'WARNING',
      detail: {},
      dedupKey: 'dk-1',
    });
    const second = await repo.createEvent({
      organizationId: orgId,
      ruleId: rule.id,
      deviceId: null,
      kind: 'RESOLVED',
      severity: 'WARNING',
      detail: {},
      dedupKey: 'dk-1',
    });

    const latest = await repo.latestEventFor(orgId, rule.id, null);
    expect(latest?.id).toBe(second.id);

    const list = await repo.listEvents(orgId, 10);
    expect(list.map((e) => e.id)).toEqual(expect.arrayContaining([second.id]));
  });

  it('enqueues + finds due deliveries, then marks one delivered', async () => {
    const rule = await repo.createRule(orgId, {
      name: 'delivery-rule',
      trigger: 'STATE_TRANSITION',
      scope: { all: true },
      severity: 'CRITICAL',
      channelIds: [],
      cooldownSeconds: 60,
      notifyOnRecovery: true,
    });
    const channel = await repo.createChannel(orgId, { type: 'WEBHOOK', name: 'wh', config: {} });
    const event = await repo.createEvent({
      organizationId: orgId,
      ruleId: rule.id,
      deviceId: null,
      kind: 'FIRING',
      severity: 'CRITICAL',
      detail: {},
      dedupKey: 'dk-delivery',
    });

    const now = new Date();
    await repo.enqueueDeliveries(event.id, [channel.id], now);

    const due = await repo.dueDeliveries(new Date(now.getTime() + 1000), 50);
    const mine = due.find((d) => d.alertEventId === event.id);
    expect(mine).toBeDefined();
    expect(mine!.channelId).toBe(channel.id);
    expect(mine!.status).toBe('PENDING');

    await repo.markDelivery(mine!.id, { status: 'SENT', attempts: 1, lastAttemptAt: new Date() });
    const stillDue = await repo.dueDeliveries(new Date(now.getTime() + 1000), 50);
    expect(stillDue.some((d) => d.id === mine!.id)).toBe(false);
  });
});
