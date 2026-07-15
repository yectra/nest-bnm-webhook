import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
    getHealth() {
        return {
            success: true,
            status: 'UP',
            service: 'Company Backend',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
        };
    }
}