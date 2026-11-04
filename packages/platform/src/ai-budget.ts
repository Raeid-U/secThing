import type { ChatMessage } from "./ai.js";

// Deliberately conservative UTF-8 estimate, including chat-template safety space.
// This is an estimate, not a model-specific tokenizer or a proof of exact fit.
export function estimateTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 3);
}

export function estimateMessages(messages: ChatMessage[]): number {
  return 256 + messages.reduce((sum, message) => sum + 16 + estimateTokens(message.content), 0);
}

export function fitsContext(messages: ChatMessage[], contextWindow: number, outputTokens: number): boolean {
  return estimateMessages(messages) + outputTokens <= contextWindow;
}
