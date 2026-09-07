export type HistoryMessage = { role: 'user' | 'assistant'; content: string };
export type Citation = { url: string; title: string };
export type ChatEvent =
  | { type: 'stage'; stage: 'improving' | 'answering' }
  | { type: 'improved'; prompt: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      citations: Citation[];
      searchCount?: number;
      seconds: number;
    }
  | { type: 'error'; message: string };
