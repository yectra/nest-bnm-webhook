import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    healthController = app.get<HealthController>(HealthController);
  });

  describe('getHealth', () => {
    it('should return UP status', () => {
      const result = healthController.getHealth();
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('status', 'UP');
    });
  });
});
