import * as crypto from "crypto";

export class CryptoUtil {
  static generateRandomToken(length: number = 32): string {
    return crypto.randomBytes(length).toString("hex");
  }

  static signBox(uid: string, batchNumber: string): string {
    const key = process.env.QR_SECRET_KEY;
    if (!key) throw new Error("QR_SECRET_KEY is required");
    return crypto.createHmac("sha256", key).update(`${uid.toLowerCase()}:${batchNumber}`).digest("hex");
  }

  static verifyBoxSignature(uid: string, batchNumber: string, signature: string): boolean {
    const expected = Buffer.from(CryptoUtil.signBox(uid, batchNumber));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
}
