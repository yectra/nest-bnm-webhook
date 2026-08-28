import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Platform probes cannot obtain an Azure AD B2C token, and a liveness
  // check that depends on the identity provider is not a liveness check.
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Health Check',
    description: 'Unauthenticated liveness probe.',
  })
  getHealth() {
    return this.healthService.getHealth();
  }
}
