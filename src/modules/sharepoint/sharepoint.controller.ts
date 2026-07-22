import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SearchDocsDto } from './dto/search-docs.dto';
import { SharePointDoc } from './interfaces/sharepoint-doc.interface';
import { SharePointDocService } from './sharepoint-doc.service';

@ApiTags('sharepoint')
@Controller('sharepoint')
export class SharePointController {
  constructor(private readonly sharePointDocService: SharePointDocService) {}

  @Post('search')
  @ApiOperation({
    summary: 'Search SharePoint documents',
    description:
      'Full-text search across SharePoint documents via Microsoft Graph. Returns document metadata (name, URL, size, last modified) for matching driveItems.',
  })
  async search(@Body() dto: SearchDocsDto): Promise<SharePointDoc[]> {
    return this.sharePointDocService.search(dto.query, dto.top);
  }
}
