// Shared types for Biero.

export type Strategy = 'openai' | 'anthropic' | 'ollama';

export interface Provider {
  id: string;
  label: string;
  hint: string;
  baseURL: string;
  needsKey: boolean;
  strategy: Strategy;
}

export interface LlmConfig {
  provider: string;
  label?: string;
  baseURL: string;
  apiKey?: string;
  model?: string;
}

export interface TossConfig {
  clientId: string;
  clientSecret: string;
  baseURL?: string;
  verified?: boolean;
}

export interface Config {
  version: number;
  llm: LlmConfig;
  toss: TossConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
