import { Injectable } from '@nestjs/common';
import { AuthorizationResult } from 'src/common/interfaces/authorization-result.interface';
import { KnowledgeDomain } from 'src/common/enums/knowledge-domain.enum';

@Injectable()
export class AuthorizationService {
  private readonly allowedDomains = [
    KnowledgeDomain.SERVICE,
    KnowledgeDomain.CATEGORY,
    KnowledgeDomain.PROJECT,
    KnowledgeDomain.FORM,
    KnowledgeDomain.EXPERT,
    KnowledgeDomain.GENERAL,
  ];

  private readonly blockedKeywords = [
    'payment',
    'payments',
    'user',
    'users',
    'password',
    'token',
    'login',
    'otp',
    'wallet',
    'bank',
    'salary',
    'employee salary',
    'credit card',
    'account',
    'customer list',
  ];

  authorize(message: string): AuthorizationResult {
    const lowerMessage = message.toLowerCase();

    const blocked = this.blockedKeywords.find((keyword) =>
      lowerMessage.includes(keyword),
    );

    if (blocked) {
      return {
        allowed: false,
        domain: KnowledgeDomain.UNKNOWN,
        reason: `Access to "${blocked}" information is restricted.`,
      };
    }

    return {
      allowed: true,
      domain: KnowledgeDomain.GENERAL,
    };
  }
}
