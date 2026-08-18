import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { GenerationService } from './generation.service';
import { INSUFFICIENT_CONTEXT_ANSWER } from './questions.constants';

interface GenerationRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: string; content: string }>;
}

interface GenerationResponse {
  content: Array<
    { type: 'text'; text: string } | { type: 'thinking'; thinking: string }
  >;
}

describe('GenerationService', () => {
  const createMessage = jest.fn<
    Promise<GenerationResponse>,
    [GenerationRequest]
  >();
  let service: GenerationService;

  const source: RetrievalResultDto = {
    chunkId: '550e8400-e29b-41d4-a716-446655440001',
    documentId: '550e8400-e29b-41d4-a716-446655440000',
    filename: 'handbook.pdf',
    pageNumber: 7,
    content: 'Records are retained for seven years.',
    similarity: 0.91,
  };

  beforeEach(() => {
    createMessage.mockReset();
    const values: Pick<
      EnvironmentVariables,
      'ANTHROPIC_API_KEY' | 'GENERATION_MODEL' | 'GENERATION_MAX_TOKENS'
    > = {
      ANTHROPIC_API_KEY: 'test-key',
      GENERATION_MODEL: 'claude-test-model',
      GENERATION_MAX_TOKENS: 512,
    };
    const configService = {
      get: jest.fn((key: keyof typeof values) => values[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new GenerationService(configService);
    Object.defineProperty(service, 'client', {
      value: { messages: { create: createMessage } },
    });
  });

  it('sends grounded context with source metadata to Anthropic', async () => {
    createMessage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Records are retained for seven years. [Source 1]',
        },
      ],
    });

    await expect(
      service.generate('How long are records kept?', [source]),
    ).resolves.toBe('Records are retained for seven years. [Source 1]');
    const request = createMessage.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: 'claude-test-model',
      max_tokens: 512,
      messages: [{ role: 'user' }],
    });
    expect(request?.system).toContain(
      'Answer only with facts explicitly supported by the provided context',
    );
    expect(request?.system).toContain(INSUFFICIENT_CONTEXT_ANSWER);
    expect(request?.messages[0]?.content).toContain(
      '"filename": "handbook.pdf"',
    );
    expect(request?.messages[0]?.content).toContain(
      'Records are retained for seven years.',
    );
  });

  it('joins text blocks and ignores non-text blocks', async () => {
    createMessage.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'internal' },
        { type: 'text', text: 'First paragraph.' },
        { type: 'text', text: 'Second paragraph.' },
      ],
    });

    await expect(service.generate('question', [source])).resolves.toBe(
      'First paragraph.\nSecond paragraph.',
    );
  });

  it('wraps provider failures with generation context', async () => {
    const providerError = new Error('provider unavailable');
    createMessage.mockRejectedValue(providerError);

    await expect(service.generate('question', [source])).rejects.toMatchObject({
      message: 'Generation provider request failed: provider unavailable',
      cause: providerError,
    });
  });
});
