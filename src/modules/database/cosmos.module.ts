import { Module } from '@nestjs/common';
import { CosmosService } from './cosmos.service';

@Module({
  providers: [CosmosService],
  exports: [CosmosService],
})
export class CosmosModule {}
