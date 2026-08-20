import {
  deterministicEmbedding,
  EVALUATION_EMBEDDING_DIMENSIONS,
} from './deterministic-embedding';

describe('deterministic evaluation embedding', () => {
  it('creates stable normalized vectors with the pgvector schema dimension', () => {
    const first = deterministicEmbedding(
      'security audit logs retained 90 days',
    );
    const second = deterministicEmbedding(
      'security audit logs retained 90 days',
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(EVALUATION_EMBEDDING_DIMENSIONS);
    expect(
      Math.sqrt(first.reduce((sum, value) => sum + value ** 2, 0)),
    ).toBeCloseTo(1);
  });

  it('canonicalizes selected paraphrases reproducibly', () => {
    expect(deterministicEmbedding('paid time off')).toEqual(
      deterministicEmbedding('annual leave'),
    );
    expect(deterministicEmbedding('two-factor authentication')).toEqual(
      deterministicEmbedding('mfa'),
    );
  });
});
