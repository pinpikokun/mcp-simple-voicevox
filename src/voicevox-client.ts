import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface SpeakOptions {
  text: string;
  speaker: number;
  speedScale?: number;
}

export class VoicevoxClient {
  constructor(private endpoint: string) {}

  async speak(
    text: string,
    speaker: number,
    speedScale?: number
  ): Promise<void> {
    try {
      // 音声クエリの作成
      const queryResponse = await fetch(
        `${this.endpoint}/audio_query?${new URLSearchParams({ text, speaker: String(speaker) })}`,
        { method: 'POST' }
      );

      if (!queryResponse.ok) {
        throw new Error(
          `VOICEVOX APIエラー: ${queryResponse.status} ${queryResponse.statusText}`
        );
      }

      const audioQuery = (await queryResponse.json()) as Record<
        string,
        unknown
      >;

      if (speedScale !== undefined) {
        audioQuery.speedScale = speedScale;
      }

      // 音声合成
      const synthesisResponse = await fetch(
        `${this.endpoint}/synthesis?${new URLSearchParams({ speaker: String(speaker) })}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(audioQuery),
        }
      );

      if (!synthesisResponse.ok) {
        throw new Error(
          `VOICEVOX APIエラー: ${synthesisResponse.status} ${synthesisResponse.statusText}`
        );
      }

      const audioData = await synthesisResponse.arrayBuffer();
      await this.playAudio(audioData);
    } catch (error) {
      if (
        error instanceof TypeError &&
        (error as TypeError & { cause?: { code?: string } }).cause?.code ===
          'ECONNREFUSED'
      ) {
        throw new Error(
          'VOICEVOXエンジンに接続できません。VOICEVOXが起動しているか確認してください。'
        );
      }
      throw error;
    }
  }

  private async playAudio(audioData: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const tempFilePath = join(tmpdir(), `voicevox_${Date.now()}.wav`);

      writeFileSync(tempFilePath, Buffer.from(audioData));

      let command: string;
      let args: string[];

      switch (process.platform) {
        case 'darwin':
          command = 'afplay';
          args = [tempFilePath];
          break;
        case 'linux':
          command = 'aplay';
          args = [tempFilePath];
          break;
        case 'win32':
          command = 'powershell';
          args = [
            '-c',
            `(New-Object Media.SoundPlayer "${tempFilePath}").PlaySync()`,
          ];
          break;
        default:
          unlinkSync(tempFilePath);
          reject(
            new Error(
              `サポートされていないプラットフォーム: ${process.platform}`
            )
          );
          return;
      }

      const player = spawn(command, args);

      player.on('close', (code) => {
        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          console.error('一時ファイルの削除に失敗:', e);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`音声再生に失敗しました。終了コード: ${code}`));
        }
      });

      player.on('error', (error) => {
        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          console.error('一時ファイルの削除に失敗:', e);
        }
        reject(new Error(`音声再生エラー: ${error.message}`));
      });
    });
  }

  async getSpeakers(): Promise<unknown[]> {
    try {
      const response = await fetch(`${this.endpoint}/speakers`);

      if (!response.ok) {
        throw new Error(
          `VOICEVOX APIエラー: ${response.status} ${response.statusText}`
        );
      }

      return response.json() as Promise<unknown[]>;
    } catch (error) {
      if (
        error instanceof TypeError &&
        (error as TypeError & { cause?: { code?: string } }).cause?.code ===
          'ECONNREFUSED'
      ) {
        throw new Error(
          'VOICEVOXエンジンに接続できません。VOICEVOXが起動しているか確認してください。'
        );
      }
      throw error;
    }
  }
}
