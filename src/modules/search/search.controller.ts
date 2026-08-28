import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RetrievalResult } from '../../common/interfaces/retrieval-result.interface';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('semantic')
  @ApiOperation({
    summary: 'Semantic search over the marketplace catalog',
    description:
      'Embeds the query and runs a Cosmos DB vector (VectorDistance) search over the catalog containers, returning the nearest matches ranked by distance. Requires an Azure AD B2C access token.',
  })
  async semantic(@Body() dto: SemanticSearchDto): Promise<RetrievalResult[]> {
    return this.searchService.semanticSearch(
      dto.query,
      dto.containers,
      dto.top,
    );
  }
}
