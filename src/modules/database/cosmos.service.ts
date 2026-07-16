import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container } from '@azure/cosmos';

@Injectable()
export class CosmosService {
  private readonly client: CosmosClient;
  private readonly database: Database;

  constructor(private readonly configService: ConfigService) {
    this.client = new CosmosClient({
      endpoint: this.configService.get<string>('COSMOS_ENDPOINT')!,
      key: this.configService.get<string>('COSMOS_KEY')!,
    });

    this.database = this.client.database(
      this.configService.get<string>('COSMOS_DATABASE')!,
    );
  }

  getContainer(containerName: string): Container {
    return this.database.container(containerName);
  }
}
