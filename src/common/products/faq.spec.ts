import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { faqForStorage, validFaqEntries } from './faq';
import { UpdateSuggestionDto } from '../../modules/admin/dto/update-suggestion.dto';

/**
 * The transform options main.ts gives the global ValidationPipe. Without
 * `@Type()` on `faq`, every entry came out of the pipe as `[]` — the questions
 * and answers were gone before the service or Prisma ran.
 */
const PIPE_OPTIONS = { enableImplicitConversion: true } as const;

describe('product FAQ through the validation pipe', () => {
  it('keeps entries as objects', () => {
    const faq = [
      { question: 'What is the MOQ?', answer: '100 units.' },
      { question: 'Is it in stock?', answer: 'Yes, ships in 48 hours.' },
    ];

    const dto = plainToInstance(UpdateSuggestionDto, { name: 'Dolo 650', faq }, PIPE_OPTIONS);

    expect(dto.faq).toEqual(faq);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an entry that is missing its answer', () => {
    const dto = plainToInstance(
      UpdateSuggestionDto,
      { faq: [{ question: 'What is the MOQ?' }] },
      PIPE_OPTIONS,
    );

    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});

describe('validFaqEntries', () => {
  it('drops the flattened rows written before the DTO carried @Type()', () => {
    expect(validFaqEntries([[], [], []])).toEqual([]);
  });

  it('drops blank and half-filled rows but keeps the rest', () => {
    const entries = validFaqEntries([
      { question: 'Kept?', answer: 'Yes.' },
      { question: '   ', answer: 'No question.' },
      { question: 'No answer.', answer: '' },
      null,
      'not an object',
    ]);

    expect(entries).toEqual([{ question: 'Kept?', answer: 'Yes.' }]);
  });
});

describe('faqForStorage', () => {
  it('trims what it keeps', () => {
    expect(faqForStorage([{ question: '  Q?  ', answer: '  A.  ' }])).toEqual([
      { question: 'Q?', answer: 'A.' },
    ]);
  });

  it('returns null when nothing is worth storing', () => {
    expect(faqForStorage([[], []])).toBeNull();
    expect(faqForStorage([])).toBeNull();
    expect(faqForStorage(null)).toBeNull();
  });
});
