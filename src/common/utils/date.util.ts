export class DateUtil {
  static formatToISOString(date: Date = new Date()): string {
    return date.toISOString();
  }

  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  static isExpired(expiryDate: Date): boolean {
    return new Date().getTime() > new Date(expiryDate).getTime();
  }
}
