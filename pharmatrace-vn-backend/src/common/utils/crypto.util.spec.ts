import { CryptoUtil } from './crypto.util';

describe('CryptoUtil box signatures', () => {
  const uid = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
  const original = process.env.QR_SECRET_KEY;

  beforeEach(() => { process.env.QR_SECRET_KEY = 'test-signing-key'; });
  afterAll(() => {
    if (original === undefined) delete process.env.QR_SECRET_KEY; else process.env.QR_SECRET_KEY = original;
  });

  it('verifies the signature it produced', () => {
    expect(CryptoUtil.verifyBoxSignature(uid, 'LOT-1', CryptoUtil.signBox(uid, 'LOT-1'))).toBe(true);
  });

  it('ignores the letter case of the uid', () => {
    expect(CryptoUtil.verifyBoxSignature(uid.toUpperCase(), 'LOT-1', CryptoUtil.signBox(uid, 'LOT-1'))).toBe(true);
  });

  it('rejects a signature for another box, another batch or another key', () => {
    const signature = CryptoUtil.signBox(uid, 'LOT-1');
    expect(CryptoUtil.verifyBoxSignature('3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', 'LOT-1', signature)).toBe(false);
    expect(CryptoUtil.verifyBoxSignature(uid, 'LOT-2', signature)).toBe(false);
    process.env.QR_SECRET_KEY = 'another-key';
    expect(CryptoUtil.verifyBoxSignature(uid, 'LOT-1', signature)).toBe(false);
  });

  it('rejects an empty or truncated signature', () => {
    const signature = CryptoUtil.signBox(uid, 'LOT-1');
    expect(CryptoUtil.verifyBoxSignature(uid, 'LOT-1', '')).toBe(false);
    expect(CryptoUtil.verifyBoxSignature(uid, 'LOT-1', signature.slice(1))).toBe(false);
  });

  it('refuses to sign without a key', () => {
    delete process.env.QR_SECRET_KEY;
    expect(() => CryptoUtil.signBox(uid, 'LOT-1')).toThrow('QR_SECRET_KEY is required');
  });
});
