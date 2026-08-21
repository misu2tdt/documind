import { resolve } from 'node:path';
import { loadEvaluationDataset } from './dataset';

describe('evaluation dataset', () => {
  it('loads reference answers for all supported baseline cases', async () => {
    const dataset = await loadEvaluationDataset(
      resolve('evaluation/datasets/phase-4c-baseline.json'),
    );
    const supported = dataset.cases.filter(
      (evaluationCase) => evaluationCase.expectedSources.length > 0,
    );

    expect(dataset.cases).toHaveLength(25);
    expect(supported).toHaveLength(22);
    expect(
      supported.every(
        (evaluationCase) =>
          typeof evaluationCase.referenceAnswer === 'string' &&
          evaluationCase.referenceAnswer.length > 0,
      ),
    ).toBe(true);
  });
});
