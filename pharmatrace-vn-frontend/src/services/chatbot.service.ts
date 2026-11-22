import { apiClient } from './api.client';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatProduct {
  id: number;
  slug: string | null;
  name: string;
  imageUrl: string | null;
  price: number;
  requiresPrescription: boolean;
  reason: string;
}

export interface ChatbotReply {
  answer: string;
  products: ChatProduct[];
  followUpQuestions: string[];
  needsDoctor: boolean;
  emergency: boolean;
  disclaimer: string;
}

interface Envelope<T> { success: boolean; data: T }

/** The API client rejects with the response body or a plain string; turn either into a readable message. */
export function chatbotErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    // The API hides the detail of 5xx errors behind an English generic message.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 500) return 'The assistant is temporarily unavailable. Please try again later or ask a pharmacist directly.';
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return 'The assistant is busy. Please try again shortly.';
}

export const chatbotService = {
  async ask(message: string, history: ChatTurn[]): Promise<ChatbotReply> {
    const res = (await apiClient.post('/chatbot/ask', { message, history })) as unknown as Envelope<ChatbotReply>;
    return res.data;
  },
};
