import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

const getCurrentUsageMock = vi.fn();
const trackUsageMock = vi.fn();

// The KV cache is available only when a fake store is installed for a test.
let fakeKV: {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
} | null = null;

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (!fakeKV) throw new Error('no cloudflare context');
    return { env: { TRANSLATIONS_KV: fakeKV } };
  },
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' }),
  getSubscriptionPlan: () => 'free',
  getDailyTranslationPlanData: () => ({ quota: 1000 }),
}));
vi.mock('@/utils/usage', () => ({
  UsageStatsManager: {
    getCurrentUsage: (...a: unknown[]) => getCurrentUsageMock(...a),
    trackUsage: (...a: unknown[]) => trackUsageMock(...a),
  },
}));

import handler from '@/pages/api/deepl/translate';

const call = async (body: unknown) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer tok' }, body } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
};

const deeplResponseFor = (texts: string[]) =>
  new Response(JSON.stringify({ translations: texts.map((text) => ({ text })) }), {
    status: 200,
  });

const cacheKey = (text: string, source = 'AUTO', target = 'EN') =>
  `tr:${crypto.createHash('sha1').update(`${source}:${target}:${text}`).digest('hex')}`;

const makeKV = (store: Record<string, string>) => ({
  get: vi.fn(async (key: string) => store[key] ?? null),
  put: vi.fn(async () => {}),
});

beforeEach(() => {
  getCurrentUsageMock.mockReset().mockResolvedValue(0);
  trackUsageMock.mockReset().mockResolvedValue(100);
  fakeKV = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('DeepL translate request limits', () => {
  it.each([
    ['a string instead of an array', 'hello'],
    ['a missing text field', undefined],
    ['a non-string item', ['hello', 42]],
  ])('rejects %s without calling DeepL', async (_label, text) => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponseFor(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text, target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with too many items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponseFor(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: Array.from({ length: 101 }, () => 'a'), target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with too many characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponseFor(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: ['a'.repeat(50_001)], target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the whole request against the quota before any upstream call', async () => {
    // 10 x 200 chars: each item alone fits the 1000-char quota, the request does not.
    const fetchMock = vi.fn().mockResolvedValue(deeplResponseFor(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: Array.from({ length: 10 }, () => 'a'.repeat(200)) });
    expect(res.status).toHaveBeenCalledWith(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackUsageMock).not.toHaveBeenCalled();
  });

  it('translates the whole request in ONE upstream call and records usage once', async () => {
    // Every item used to fan out into its own upstream request, which burst
    // DeepL's rate limit (429) for multi-sentence batches.
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return deeplResponseFor((body.text as string[]).map((text) => `>${text}<`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: ['hello', '', 'world'], target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(200);
    // One upstream call for both non-empty texts; the empty one never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(requestBody.text).toEqual(['hello', 'world']);
    expect(trackUsageMock).toHaveBeenCalledTimes(1);
    const { translations } = res.json.mock.calls[0]![0] as { translations: { text: string }[] };
    expect(translations.map((t) => t.text)).toEqual(['>hello<', '', '>world<']);
  });

  it('keeps cached and freshly translated items aligned by index', async () => {
    const store: Record<string, string> = {};
    store[cacheKey('cached sentence.')] = 'CACHED';
    fakeKV = makeKV(store);
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return deeplResponseFor((body.text as string[]).map((text) => `>${text}<`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({
      text: ['cached sentence.', 'fresh one.', 'another fresh.'],
      target_lang: 'EN',
      use_cache: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    // Only the two uncached texts go upstream, in one call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(requestBody.text).toEqual(['fresh one.', 'another fresh.']);
    const { translations } = res.json.mock.calls[0]![0] as { translations: { text: string }[] };
    expect(translations.map((t) => t.text)).toEqual(['CACHED', '>fresh one.<', '>another fresh.<']);
  });
});
