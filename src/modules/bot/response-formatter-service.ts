import { Injectable } from '@nestjs/common';

@Injectable()
export class ResponseFormatterService {
  format(data: unknown): string {
    if (data == null) {
      return 'No data available.';
    }

    if (typeof data === 'string') {
      return this.formatText(data);
    }

    if (Array.isArray(data)) {
      return this.formatArray(data);
    }

    if (typeof data === 'object') {
      return this.formatObject(data as Record<string, unknown>);
    }

    return String(data);
  }

  private formatText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/^- /gm, '• ')
      .replace(/^\* /gm, '• ')
      .trim();
  }

  private formatArray(arr: unknown[]): string {
    return arr
      .map((item, index) => {
        if (typeof item === 'object' && item !== null) {
          return `${index + 1}.\n${this.formatObject(
            item as Record<string, unknown>,
          )}`;
        }

        return `• ${String(item)}`;
      })
      .join('\n\n');
  }

  private formatObject(obj: Record<string, unknown>): string {
    return Object.entries(obj)
      .map(([key, value]) => {
        return `• ${this.prettyKey(key)}: ${this.valueToString(value)}`;
      })
      .join('\n');
  }

  private valueToString(value: unknown): string {
    if (value == null) return '-';

    if (typeof value === 'string') return value;

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.valueToString(v)).join(', ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  private prettyKey(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
  }
}
