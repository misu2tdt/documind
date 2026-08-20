import { createHash } from 'node:crypto';

export const EVALUATION_EMBEDDING_DIMENSIONS = 1536;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'our',
  'the',
  'to',
  'what',
  'when',
  'which',
  'with',
]);

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/paid time off|vacation allowance/gi, 'annual leave'],
  [/work(?:ing)? from home/gi, 'remote work'],
  [/proof of purchase/gi, 'receipt'],
  [/two[- ]factor authentication/gi, 'mfa'],
  [/highest severity/gi, 'critical severity'],
  [/lessons[- ]learned review/gi, 'postmortem'],
  [/erase (?:account|customer) (?:information|data)/gi, 'deletion request'],
  [/planned downtime/gi, 'maintenance window'],
  [/reaction time/gi, 'acknowledgement time'],
];

const TOKEN_ALIASES: Record<string, string> = {
  airfare: 'flight',
  bills: 'receipt',
  erased: 'deletion',
  erase: 'deletion',
  logs: 'log',
  purchases: 'expense',
  records: 'record',
  reimbursed: 'reimbursement',
  reimburse: 'reimbursement',
  replies: 'response',
  respond: 'response',
  servers: 'service',
  tickets: 'ticket',
};

export function deterministicEmbedding(text: string): number[] {
  const vector = Array<number>(EVALUATION_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) addFeature(vector, token, 1);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    addFeature(vector, `${tokens[index]}_${tokens[index + 1]}`, 0.45);
  }

  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

function tokenize(text: string): string[] {
  const normalized = PHRASE_ALIASES.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text.toLowerCase(),
  );
  const tokens: string[] = normalized.match(/[a-z0-9]+/g) ?? [];
  return tokens
    .map((token: string) => TOKEN_ALIASES[token] ?? stem(token))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const digest = createHash('sha256').update(feature).digest();
  const index = digest.readUInt16BE(0) % EVALUATION_EMBEDDING_DIMENSIONS;
  const sign = digest[2] % 2 === 0 ? 1 : -1;
  vector[index] += sign * weight;
}
