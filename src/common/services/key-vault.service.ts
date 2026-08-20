import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

@Injectable()
export class KeyVaultService {
  private readonly logger = new Logger(KeyVaultService.name);
  private secretClient: SecretClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const keyVaultUrl =
      this.configService.get<string>('azure.keyVaultUrl') ||
      process.env.AZURE_KEYVAULT_URL ||
      process.env.KEY_VAULT_URL;

    if (keyVaultUrl) {
      try {
        const credential = new DefaultAzureCredential();
        this.secretClient = new SecretClient(keyVaultUrl, credential);
        this.logger.log(`KeyVaultService initialized with vault URL: ${keyVaultUrl}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to initialize Azure Key Vault client: ${message}`,
        );
      }
    } else {
      this.logger.log(
        'Azure Key Vault URL not configured. KeyVaultService will use environment fallback.',
      );
    }
  }

  /**
   * Retrieves a secret value from Azure Key Vault, falling back to environment variables.
   * NEVER logs or exposes the returned secret value.
   */
  async getSecret(secretName: string): Promise<string | null> {
    if (this.secretClient && secretName) {
      try {
        const secret = await this.secretClient.getSecret(secretName);
        if (secret?.value) {
          return secret.value;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to retrieve secret '${secretName}' from Azure Key Vault: ${message}. Attempting environment fallback.`,
        );
      }
    }

    // Fallback to environment variable or config
    const envSecret =
      process.env[secretName] ||
      process.env[secretName.toUpperCase().replace(/-/g, '_')] ||
      this.configService.get<string>('azure.eventSecurityKey') ||
      process.env.EVENT_SECURITY_KEY ||
      process.env.AZURE_KEYVAULT_EVENT_SECURITY_KEY;

    return envSecret || null;
  }

  /**
   * Retrieves the expected security key for Event Capture validation.
   */
  async getEventSecurityKey(): Promise<string | null> {
    const secretName =
      this.configService.get<string>('azure.secretName') ||
      process.env.AZURE_KEYVAULT_SECRET_NAME ||
      process.env.KEY_VAULT_SECRET_NAME ||
      'event-capture-security-key';

    return this.getSecret(secretName);
  }
}
