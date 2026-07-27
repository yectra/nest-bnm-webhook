// src/modules/ai/fabric-iq/fabric-iq.controller.ts
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { FabricIqService } from './fabric-iq.service';

@Controller('fabric')
export class FabricIqController {
  constructor(private readonly fabric: FabricIqService) {}

  @Post('graphql')
  async graphql(@Body() body: { query?: string; variables?: any }) {
    if (!body || typeof body.query !== 'string') {
      // Throw a clear BadRequestException instead of a TypeError
      throw new BadRequestException(
        'Request body must contain a "query" string',
      );
    }
    return this.fabric.queryGraphQL(body.query, body.variables);
  }

  @Post('graph')
  async graph(@Body() body: { query?: string; parameters?: any }) {
    if (!body || typeof body.query !== 'string') {
      throw new BadRequestException(
        'Request body must contain a "query" string',
      );
    }
    return this.fabric.executeGraphQuery(body.query, body.parameters);
  }
}
