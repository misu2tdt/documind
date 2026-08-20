export const RETRIEVAL_STRATEGIES = ['vector', 'hybrid'] as const;

export type RetrievalStrategy = (typeof RETRIEVAL_STRATEGIES)[number];
