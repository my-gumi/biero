import type { Provider } from '../shared/types.js';

export const PROVIDERS: Provider[] = [
  { id: 'openai', label: 'OpenAI', hint: 'gpt-4o, gpt-4.1 …', baseURL: 'https://api.openai.com/v1', needsKey: true, strategy: 'openai' },
  { id: 'anthropic', label: 'Anthropic', hint: 'claude (Opus · Sonnet · Haiku)', baseURL: 'https://api.anthropic.com', needsKey: true, strategy: 'anthropic' },
  { id: 'openrouter', label: 'OpenRouter', hint: '300+ models, 단일 키', baseURL: 'https://openrouter.ai/api/v1', needsKey: true, strategy: 'openai' },
  { id: 'google', label: 'Google Gemini', hint: 'gemini-* (OpenAI 호환)', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, strategy: 'openai' },
  { id: 'groq', label: 'Groq', hint: '초고속 추론', baseURL: 'https://api.groq.com/openai/v1', needsKey: true, strategy: 'openai' },
  { id: 'xai', label: 'xAI (Grok)', hint: 'grok-*', baseURL: 'https://api.x.ai/v1', needsKey: true, strategy: 'openai' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'deepseek-chat / reasoner', baseURL: 'https://api.deepseek.com', needsKey: true, strategy: 'openai' },
  { id: 'mistral', label: 'Mistral', hint: 'mistral-*', baseURL: 'https://api.mistral.ai/v1', needsKey: true, strategy: 'openai' },
  { id: 'ollama', label: 'Ollama (로컬)', hint: '내 PC에서 실행, 키 불필요', baseURL: 'http://localhost:11434/v1', needsKey: false, strategy: 'ollama' },
  { id: 'custom', label: '직접 입력 (OpenAI 호환 엔드포인트)', hint: 'Base URL 직접 지정', baseURL: '', needsKey: true, strategy: 'openai' },
];

export function getProvider(id: string | undefined): Provider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

// Substrings that mark a NON-chat model (embeddings, speech, image, etc.).
const NON_CHAT: string[] = [
  'embedding', 'embed-', 'whisper', 'tts', 'text-to-speech', 'audio', 'transcribe',
  'realtime', 'dall-e', 'dalle', 'image', 'imagen', 'moderation', 'rerank', 'guard',
  '-search', 'search-', 'similarity', '-edit', 'babbage', 'curie', 'davinci',
  'instruct', 'aqa', 'sora', 'veo',
];

// Ordered "flagship-first" family prefixes per provider, used only for ranking.
const FAMILIES: Record<string, string[]> = {
  openai: ['gpt-5', 'o4', 'o3', 'gpt-4.1', 'gpt-4o', 'o1', 'gpt-4', 'chatgpt'],
  anthropic: ['claude'],
  google: ['gemini'],
  xai: ['grok'],
  deepseek: ['deepseek'],
  mistral: ['mistral', 'magistral', 'codestral', 'pixtral', 'ministral'],
};

const DATED = /(\d{4}-\d{2}-\d{2})|(-\d{4})$/; // dated snapshot suffix → rank below its alias

/**
 * Filter a raw model id list down to chat models and sort flagship-first.
 */
export function curateModels(provider: Provider | null | undefined, ids: string[] = []): string[] {
  const families = (provider && FAMILIES[provider.id]) ?? [];
  const chat = ids.filter((id) => {
    const l = String(id).toLowerCase();
    return Boolean(l) && !NON_CHAT.some((k) => l.includes(k));
  });
  const rank = (id: string): number => {
    const l = id.toLowerCase();
    let fam = families.findIndex((f) => l.startsWith(f));
    if (fam === -1) fam = families.length;
    return fam * 10 + (DATED.test(l) ? 1 : 0);
  };
  return [...chat].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export interface LlmValidation {
  ok: boolean;
  models?: string[];
  status?: number;
  message?: string;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/** Validate an LLM provider's credentials by listing models. */
export async function validateLLM(
  provider: Provider,
  apiKey: string,
  baseURL: string,
): Promise<LlmValidation> {
  const base = (baseURL || provider.baseURL || '').replace(/\/+$/, '');
  if (!base) return { ok: false, message: 'Base URL이 비어 있어요.' };

  const t = withTimeout(10_000);
  try {
    let res: Response;
    if (provider.strategy === 'ollama') {
      const root = base.replace(/\/v1$/, '');
      res = await fetch(`${root}/api/tags`, { signal: t.signal });
    } else if (provider.strategy === 'anthropic') {
      res = await fetch(`${base}/v1/models`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: t.signal,
      });
    } else {
      res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: t.signal,
      });
    }

    if (!res.ok) {
      let message: string | undefined;
      try {
        const e: any = await res.json();
        message = e?.error?.message || e?.message;
      } catch {
        /* ignore parse error */
      }
      return { ok: false, status: res.status, message };
    }

    const data: any = await res.json().catch(() => ({}));
    let models: string[] = [];
    if (Array.isArray(data?.data)) models = data.data.map((m: any) => m.id).filter(Boolean);
    else if (Array.isArray(data?.models)) models = data.models.map((m: any) => m.name || m.id).filter(Boolean);
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, message: e?.name === 'AbortError' ? '시간 초과' : e?.message };
  } finally {
    t.done();
  }
}
