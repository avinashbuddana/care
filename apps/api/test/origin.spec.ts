import type { Request } from 'express';
import { sameHost } from '../src/common/guards/access.guard';

const req = (headers: Record<string, string>) =>
  ({ get: (name: string) => headers[name.toLowerCase()] }) as Pick<Request, 'get'>;

describe('sameHost', () => {
  it('accepts the address the browser used, as forwarded by the web app', () => {
    expect(
      sameHost(
        'http://server01:8050',
        req({ 'x-forwarded-host': 'server01:8050', host: 'api:3001' }),
      ),
    ).toBe(true);
  });
  it('rejects another site', () => {
    expect(sameHost('http://evil.example', req({ 'x-forwarded-host': 'server01:8050' }))).toBe(
      false,
    );
  });
  it('rejects a different port on the same host', () => {
    expect(sameHost('http://server01:9999', req({ host: 'server01:8050' }))).toBe(false);
  });
  it('rejects an unparseable origin', () => {
    expect(sameHost('null', req({ host: 'server01:8050' }))).toBe(false);
  });
});
