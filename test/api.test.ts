import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, NetworkError } from '../src/core/api';
import { getApiBase } from '../src/core/apiBase';

test('API base requires a valid HTTPS origin and normalizes its trailing slash', () => {
  assert.equal(getApiBase('https://api.example.test/'), 'https://api.example.test');
  assert.throws(() => getApiBase(undefined), /EXPO_PUBLIC_API_BASE is missing/);
  assert.throws(() => getApiBase('http://api.example.test'), /HTTPS origin/);
  assert.throws(() => getApiBase('https://api.example.test/path'), /without credentials, path/);
});

test('API retries transient failures three times with exponential backoff and exposes connection state', async () => {
  const waits: number[] = [];
  const states: boolean[] = [];
  let calls = 0;
  const api = new Api({
    baseUrl: 'https://api.example.test/',
    getToken: () => null,
    sleep: async milliseconds => { waits.push(milliseconds); },
    onConnectionState: connecting => { states.push(connecting); },
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error('network unavailable');
      if (calls === 2) return { status: 503, ok: false, text: async () => 'unavailable' };
      return { status: 200, ok: true, text: async () => '{"ok":true}' };
    },
  });

  assert.deepEqual(await api.me(), { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.deepEqual(states, [true, false]);
});

test('API keeps network failures retryable by callers and does not exceed three attempts', async () => {
  let calls = 0;
  const waits: number[] = [];
  const api = new Api({
    baseUrl: 'https://api.example.test',
    getToken: () => null,
    sleep: async milliseconds => { waits.push(milliseconds); },
    fetchImpl: async () => { calls++; throw new Error('offline'); },
  });

  await assert.rejects(() => api.me(), NetworkError);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
});
