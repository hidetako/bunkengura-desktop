// Anthropic の例外を、利用者が次に何をすればよいか分かる日本語にする。
// 辞書・翻訳と書き起こしの両方で同じ文言を使う。
import Anthropic from '@anthropic-ai/sdk';

export function toJapaneseError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error('APIキーが正しくありません。設定画面で入力し直してください。');
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new Error('このAPIキーでは利用が許可されていません。Anthropic コンソールで権限をご確認ください。');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Error('呼び出しが混み合っています。少し待ってからもう一度お試しください。');
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new Error(`リクエストが受け付けられませんでした: ${e.message}`);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new Error('Anthropic に接続できませんでした。ネットワーク接続をご確認ください。');
  }
  if (e instanceof Anthropic.APIError) {
    // 残高切れはこの型で来るので、気づけるように添える
    const hint = e.status === 400 && /credit|balance/i.test(e.message) ? '（残高をご確認ください）' : '';
    return new Error(`APIエラー (${e.status})${hint}: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
