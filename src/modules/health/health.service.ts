import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    console.log('Health check requested');
    return {
      success: true,
      status: 'UP',
      service: 'Company Backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
