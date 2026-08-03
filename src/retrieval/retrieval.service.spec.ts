import { Test, TestingModule } from '@nestjs/testing';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  let service: RetrievalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetrievalService],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
