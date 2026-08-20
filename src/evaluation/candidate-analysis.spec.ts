import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import {
  diagnoseRelevantCandidate,
  LexicalCandidate,
} from './candidate-analysis';

const expected = { filename: 'policy.pdf', pageNumber: 2 };

describe('candidate diagnostics', () => {
  it('distinguishes threshold and lexical-guard candidate removal', () => {
    const relevant = result('relevant', 0.15);
    const lexical: LexicalCandidate = {
      ...relevant,
      lexicalScore: 0.1,
      matchedTerms: 1,
      queryTerms: 3,
      lexicalMatch: true,
    };

    expect(
      diagnoseRelevantCandidate(
        expected,
        [result('other', 0.8), relevant],
        [lexical],
        [lexical],
        [],
        [],
        0.2,
      ),
    ).toMatchObject({
      vectorRank: 2,
      vectorSimilarity: 0.15,
      rawLexicalRank: 1,
      guardedLexicalRank: null,
      hybridRank: null,
      removedByBaseFilter: false,
      removedByThreshold: true,
      removedByLexicalGuard: true,
      lexicalMatchAbsent: false,
    });
  });

  it('reports a ranking failure when a candidate survives outside topK', () => {
    const relevant = result('relevant', 0.4);

    expect(
      diagnoseRelevantCandidate(
        expected,
        [relevant],
        [],
        [],
        [],
        [
          result('one', 0.8),
          result('two', 0.7),
          result('three', 0.6),
          relevant,
        ],
        0.2,
      ).hybridRank,
    ).toBe(4);
  });

  it('separates lexical query rejection from lexical guard removal', () => {
    const relevant = result('relevant', 0.08);
    const evidence: LexicalCandidate = {
      ...relevant,
      lexicalScore: 0,
      matchedTerms: 2,
      queryTerms: 5,
      lexicalMatch: false,
    };

    expect(
      diagnoseRelevantCandidate(
        expected,
        [relevant],
        [evidence],
        [],
        [],
        [],
        0.2,
      ),
    ).toMatchObject({
      lexicalMatchedTerms: 2,
      lexicalQueryTerms: 5,
      rejectedByLexicalQuery: true,
      removedByLexicalGuard: false,
      lexicalMatchAbsent: true,
    });
  });
});

function result(chunkId: string, similarity: number): RetrievalResultDto {
  return {
    chunkId,
    documentId: 'document',
    filename: chunkId === 'relevant' ? 'policy.pdf' : 'other.pdf',
    pageNumber: chunkId === 'relevant' ? 2 : 1,
    content: chunkId,
    similarity,
  };
}
