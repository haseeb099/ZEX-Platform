import { hashSourceContent, normalizeSourceText, excerptAround } from './source-normalize';

describe('source-normalize', () => {
  it('normalizes whitespace stably', () => {
    expect(normalizeSourceText('a  \n\n\nb\r\n')).toBe('a\n\nb');
  });

  it('hashes content idempotently', () => {
    const text = normalizeSourceText('Hello Company Brain');
    expect(hashSourceContent(text, 'https://a.example')).toBe(
      hashSourceContent(text, 'https://a.example'),
    );
    expect(hashSourceContent(text, 'https://a.example')).not.toBe(
      hashSourceContent(text, 'https://b.example'),
    );
  });

  it('bounds excerpts including ellipsis marks', () => {
    const long = `${'a'.repeat(400)}NEEDLE${'b'.repeat(400)}`;
    expect(excerptAround(long, 'NEEDLE', 50).length).toBeLessThanOrEqual(50);
  });
});
