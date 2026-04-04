import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { VoicevoxClient } from '../src/voicevox-client';

// child_process.spawnをモック（音声再生をスキップ）
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    process.nextTick(() => proc.emit('close', 0));
    return proc;
  }),
}));

// fs操作をモック（一時ファイル作成・削除をスキップ）
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockAudioQuery = {
  speedScale: 1.0,
  text: 'テスト',
};

const mockAudioBuffer = new ArrayBuffer(8);

function makeFetchMock(
  responses: {
    ok: boolean;
    status?: number;
    statusText?: string;
    body?: unknown;
    arrayBuffer?: ArrayBuffer;
  }[]
) {
  let callCount = 0;
  return jest.fn(async () => {
    const res = responses[callCount++];
    return {
      ok: res.ok,
      status: res.status ?? 200,
      statusText: res.statusText ?? 'OK',
      json: async () => res.body,
      arrayBuffer: async () => res.arrayBuffer ?? mockAudioBuffer,
    };
  }) as unknown as typeof fetch;
}

describe('VoicevoxClient', () => {
  let client: VoicevoxClient;
  const mockEndpoint = 'http://localhost:50021';

  beforeEach(() => {
    client = new VoicevoxClient(mockEndpoint);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('インスタンスが正しく生成される', () => {
      expect(client).toBeInstanceOf(VoicevoxClient);
    });
  });

  describe('speak()', () => {
    it('正常系: audio_query → synthesis の順でfetchを呼ぶ', async () => {
      global.fetch = makeFetchMock([
        { ok: true, body: mockAudioQuery },
        { ok: true, arrayBuffer: mockAudioBuffer },
      ]);

      await client.speak('テスト', 1, 1.2);

      expect(global.fetch).toHaveBeenCalledTimes(2);

      const firstCall = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(firstCall[0])).toContain('/audio_query');
      expect(String(firstCall[0])).toContain('speaker=1');

      const secondCall = (global.fetch as jest.Mock).mock.calls[1];
      expect(String(secondCall[0])).toContain('/synthesis');
    });

    it('speedScaleが指定された場合、audioQueryに反映される', async () => {
      global.fetch = makeFetchMock([
        { ok: true, body: { ...mockAudioQuery } },
        { ok: true, arrayBuffer: mockAudioBuffer },
      ]);

      await client.speak('テスト', 1, 1.5);

      const secondCall = (global.fetch as jest.Mock).mock.calls[1];
      const body = JSON.parse((secondCall[1] as { body: string }).body);
      expect(body.speedScale).toBe(1.5);
    });

    it('audio_queryがエラーレスポンスの場合、APIエラーをthrowする', async () => {
      global.fetch = makeFetchMock([
        { ok: false, status: 422, statusText: 'Unprocessable Entity' },
      ]);

      await expect(client.speak('テスト', 1)).rejects.toThrow(
        'VOICEVOX APIエラー: 422 Unprocessable Entity'
      );
    });

    it('synthesisがエラーレスポンスの場合、APIエラーをthrowする', async () => {
      global.fetch = makeFetchMock([
        { ok: true, body: mockAudioQuery },
        { ok: false, status: 500, statusText: 'Internal Server Error' },
      ]);

      await expect(client.speak('テスト', 1)).rejects.toThrow(
        'VOICEVOX APIエラー: 500 Internal Server Error'
      );
    });

    it('接続拒否（ECONNREFUSED）の場合、わかりやすいエラーをthrowする', async () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      const fetchError = Object.assign(new TypeError('fetch failed'), {
        cause,
      });
      global.fetch = jest
        .fn()
        .mockRejectedValue(fetchError as never) as unknown as typeof fetch;

      await expect(client.speak('テスト', 1)).rejects.toThrow(
        'VOICEVOXエンジンに接続できません'
      );
    });
  });

  describe('getSpeakers()', () => {
    it('正常系: スピーカー一覧を返す', async () => {
      const mockSpeakers = [{ name: '四国めたん', styles: [] }];
      global.fetch = makeFetchMock([{ ok: true, body: mockSpeakers }]);

      const result = await client.getSpeakers();
      expect(result).toEqual(mockSpeakers);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(call[0])).toContain('/speakers');
    });

    it('APIエラーの場合、エラーをthrowする', async () => {
      global.fetch = makeFetchMock([
        { ok: false, status: 503, statusText: 'Service Unavailable' },
      ]);

      await expect(client.getSpeakers()).rejects.toThrow(
        'VOICEVOX APIエラー: 503 Service Unavailable'
      );
    });

    it('接続拒否（ECONNREFUSED）の場合、わかりやすいエラーをthrowする', async () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      const fetchError = Object.assign(new TypeError('fetch failed'), {
        cause,
      });
      global.fetch = jest
        .fn()
        .mockRejectedValue(fetchError as never) as unknown as typeof fetch;

      await expect(client.getSpeakers()).rejects.toThrow(
        'VOICEVOXエンジンに接続できません'
      );
    });
  });
});
