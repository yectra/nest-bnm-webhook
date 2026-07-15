import * as crypto from 'crypto';

export class CryptoUtil {
  static hashSHA256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static generateRandomString(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  static compareStringSecure(str1: string, str2: string): boolean {
    if (str1.length !== str2.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(str1), Buffer.from(str2));
  }
}
