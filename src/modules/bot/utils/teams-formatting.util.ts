import { Attachment, CardFactory } from 'botbuilder';

export class TeamsFormattingUtil {
  /**
   * Automatically parses any response (string, JSON object, JSON array) 
   * into a formatted Markdown string, then wraps it in an Adaptive Card.
   */
  static formatResponseToAdaptiveCard(payload: any, title: string = '🤖 AI Assistant'): Attachment {
    let markdownString = '';

    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        markdownString = this.convertToMarkdown(parsed);
      } catch {
        // Not valid JSON, keep as standard string
        markdownString = payload;
      }
    } else {
      // It's already an object/array
      markdownString = this.convertToMarkdown(payload);
    }

    return this.createAdaptiveCard(title, markdownString);
  }

  /**
   * Converts proactive question/answer pairs into an Adaptive Card.
   */
  static formatProactiveMessage(question: string, answer: any): Attachment {
    let answerMarkdown = '';
    
    if (typeof answer === 'string') {
      try {
        const parsed = JSON.parse(answer);
        answerMarkdown = this.convertToMarkdown(parsed);
      } catch {
        answerMarkdown = answer;
      }
    } else {
      answerMarkdown = this.convertToMarkdown(answer);
    }

    const body = `**User Question:**\n\n${question}\n\n---\n\n**Response:**\n\n${answerMarkdown}`;
    return this.createAdaptiveCard('🤖 Synchronized Conversation', body);
  }

  /**
   * Safely converts parsed JSON (objects/arrays) into readable Markdown.
   */
  private static convertToMarkdown(data: any): string {
    if (!data) return '';

    // Handle Array of Objects (Table format)
    if (Array.isArray(data)) {
      if (data.length === 0) return '_No data available._';

      const firstItem = data[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        // Create Markdown Table
        const keys = Object.keys(firstItem);
        let table = `| ${keys.map((k) => this.capitalize(k)).join(' | ')} |\n`;
        table += `| ${keys.map(() => '---').join(' | ')} |\n`;

        for (const item of data) {
          table += `| ${keys.map((k) => this.formatValue(item[k])).join(' | ')} |\n`;
        }
        return table;
      } else {
        // Simple Array
        return data.map((item) => `- ${this.formatValue(item)}`).join('\n');
      }
    }

    // Handle Single Object (List format)
    if (typeof data === 'object' && data !== null) {
      let list = '';
      for (const [key, value] of Object.entries(data)) {
        list += `- **${this.capitalize(key)}:** ${this.formatValue(value)}\n`;
      }
      return list;
    }

    return String(data);
  }

  private static formatValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value); // Fallback for deep nesting
    return String(value).replace(/\|/g, '\\|'); // Escape pipes for Markdown tables
  }

  private static capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/([A-Z])/g, ' $1').trim();
  }

  /**
   * Wraps the given markdown text into a robust Microsoft Teams Adaptive Card.
   */
  private static createAdaptiveCard(title: string, markdownContent: string): Attachment {
    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      msteams: { width: 'Full' },
      body: [
        {
          type: 'TextBlock',
          text: title,
          weight: 'Bolder',
          size: 'Medium',
          wrap: true,
          color: 'Accent',
        },
        {
          type: 'TextBlock',
          text: markdownContent,
          wrap: true,
        },
      ],
    };

    return CardFactory.adaptiveCard(card);
  }
}
