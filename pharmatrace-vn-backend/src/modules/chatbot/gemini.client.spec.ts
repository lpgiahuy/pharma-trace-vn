import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { GeminiClient, l2Normalize, parseRetryDelayMs } from './gemini.client';

const client = (env: Record<string, string> = { API_GEMINI: 'test-key' }) => new GeminiClient(new ConfigService(env));
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
const fail = (status: number) => Promise.resolve({ ok: false, status, headers: new Headers(), text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) } as Response);

describe('GeminiClient', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('treats a missing or placeholder key as not configured and never calls the network', async () => {
    expect(client({}).isConfigured()).toBe(false);
    expect(client({ API_GEMINI: 'your_gemini_api_key_here' }).isConfigured()).toBe(false);
    await expect(client({}).embed(['x'], 'RETRIEVAL_QUERY')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embeds in batches of 50, sends the key as a header and returns unit vectors', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string).requests as unknown[]).length;
      return ok({ embeddings: Array.from({ length: n }, () => ({ values: [3, 4] })) });
    });
    const out = await client().embed(Array.from({ length: 250 }, (_, i) => `t${i}`), 'RETRIEVAL_DOCUMENT');
    expect(out).toHaveLength(250);
    expect(out[0][0]).toBeCloseTo(0.6);
    expect(out[0][1]).toBeCloseTo(0.8);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('models/gemini-embedding-001:batchEmbedContents');
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.requests[0]).toMatchObject({ taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 });
  });

  it('parses the JSON answer and sends the system prompt, turns and schema', async () => {
    fetchMock.mockReturnValue(ok({ candidates: [{ content: { parts: [{ text: '{"answer":"hi"}' }] } }] }));
    const out = await client().generateJson<{ answer: string }>({
      systemInstruction: 'sys', turns: [{ role: 'user', text: 'q' }], responseSchema: { type: 'OBJECT' },
    });
    expect(out).toEqual({ answer: 'hi' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } });
  });

  it('retries transient errors and then succeeds', async () => {
    fetchMock.mockReturnValueOnce(fail(503)).mockReturnValueOnce(ok({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    await expect(client().generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a client error, and rejects blocked or non-JSON answers', async () => {
    fetchMock.mockReturnValue(fail(400));
    await expect(client().generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset().mockReturnValue(ok({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(client().generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).rejects.toThrow(/blocked/);

    fetchMock.mockReset().mockReturnValue(ok({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }));
    await expect(client().generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).rejects.toThrow(/not valid JSON/);
  });

  it('reads the wait Gemini asks for from the header, RetryInfo or the message text', () => {
    expect(parseRetryDelayMs('', '7')).toBe(7000);
    expect(parseRetryDelayMs('{"details":[{"retryDelay":"21s"}]}')).toBe(21_500);
    expect(parseRetryDelayMs('{"error":{"message":"Please retry in 3.2s."}}')).toBe(3_700);
    expect(parseRetryDelayMs('{}')).toBeUndefined();
  });

  it('gives up fast on a long quota wait when a user is waiting', async () => {
    fetchMock.mockReturnValue(Promise.resolve({ ok: false, status: 429, headers: new Headers(), text: () => Promise.resolve('{"details":[{"retryDelay":"40s"}]}') } as Response));
    await expect(client().generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the fallback chat model when the main one fails', async () => {
    fetchMock.mockReturnValueOnce(fail(503)).mockReturnValueOnce(ok({ candidates: [{ content: { parts: [{ text: '{"answer":"from fallback"}' }] } }] }));
    const c = client({ API_GEMINI: 'test-key', GEMINI_CHAT_MODEL: 'main-model', GEMINI_CHAT_FALLBACK_MODEL: 'backup-model' });
    await expect(c.generateJson({ systemInstruction: 's', turns: [], responseSchema: {} })).resolves.toEqual({ answer: 'from fallback' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('models/main-model:generateContent');
    expect(fetchMock.mock.calls[1][0]).toContain('models/backup-model:generateContent');
  });

  it('ignores a fallback that equals the main model', () => {
    expect(client({ API_GEMINI: 'k', GEMINI_CHAT_MODEL: 'same', GEMINI_CHAT_FALLBACK_MODEL: 'same' }).fallbackChatModel).toBeUndefined();
  });

  it('l2Normalize returns unit vectors and tolerates zeros', () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
    expect(Math.hypot(...l2Normalize([1, 2, 3]))).toBeCloseTo(1);
  });
});
