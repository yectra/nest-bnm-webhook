import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface CatalogCategory {
  id?: string;
  name?: string;
  description?: string;
}

export interface CatalogServiceItem {
  id: string;
  name: string;
  category?: CatalogCategory;
  description?: string;
  keyFeatures?: string[];
}

export const FALLBACK_CATALOG_SERVICES: CatalogServiceItem[] = [
  {
    id: '5d69a986-efe7-4c6c-a3f5-99f8cf558725',
    name: 'New Construction',
    category: { name: 'New Construction' },
    description:
      'Transform your space with our expert Construction/Renovation services, featuring cutting-edge design, premium materials, and exceptional craftsmanship. Bringing your vision to life, from concept to completion.',
    keyFeatures: [
      'Cutting-Edge Design',
      'Premium Materials',
      'Unparalleled Craftsmanship',
      'Customized Solutions',
      'Concept-to-Completion Service',
      'Expert Project Management',
      'Sustainable and Energy-Efficient Options',
    ],
  },
  {
    id: 'd1c3387c-2a5e-4846-bb63-439ec9d1b57e',
    name: 'Kitchen Remodeling',
    category: { name: 'Kitchen Remodeling' },
    description:
      'Upgrade your kitchen and toilet with smart, stylish remodeling. From design to finish, we transform these essential spaces into modern, functional zones that suit your lifestyle.',
    keyFeatures: [
      'Custom Design',
      'Expert Installation',
      'High-Quality Materials',
      'Functional Layouts',
      'Latest Trends',
      'Budget-Friendly',
      'Warranty and Support',
      'Modern Fixtures',
      'Water-Efficient Solutions',
    ],
  },
  {
    id: '33941d44-41df-4d92-b7e1-24a3fb4c7cb4',
    name: 'Interior Works',
    category: { name: 'Interior Works' },
    description:
      'Blends style, Functionality, and Comfort to reflect your unique personality and lifestyle.',
    keyFeatures: [
      'Aesthetics',
      'Functional Layout',
      'Ergonomics & Personalisation',
    ],
  },
  {
    id: '5f2e683b-0e11-447d-a584-beb82a408605',
    name: 'Painting',
    category: { name: 'Painting' },
    description:
      'With expert craftsmanship and a passion for color, our expert painting team can transform your home or business into a vibrant, inviting space.',
    keyFeatures: [
      'Provides better aesthetic for building',
      'Provides durability for buildings',
      'Reduces the maintenance cost',
      'Increases the property value',
    ],
  },
  {
    id: 'feaf2946-9968-4363-bf80-d6eaafa0d1c0',
    name: 'Water Proofing',
    category: { name: 'Water Proofing' },
    description:
      'Our expert Waterproofing team provides you a 360 degree protection for your buildings. From basement, retaining walls, underground sump, sunken, overhead water tanks, terrace, podium, and bathrooms.',
    keyFeatures: [
      'Extends the life of building',
      'Provides a hygiene living space',
      'Improves the value of property',
      'Cost effective systems',
    ],
  },
  {
    id: '3ceb7329-c4e3-4f82-af0f-33ebcb1dc9f0',
    name: 'RO & Water Softener',
    category: { name: 'RO & Water Softener' },
    description:
      'Comprehensive RO water purifiers and domestic/commercial water softeners ensuring clean and pure water supply.',
    keyFeatures: ['Durable', 'Water resistant', 'Affordable', 'Easy Maintenance'],
  },
  {
    id: '25777757-71a7-4d50-8a47-873fafb1233b',
    name: 'Flooring - Wood Tiles Vinyl',
    category: { name: 'Flooring - Wood Tiles Vinyl' },
    description:
      'Our team of experts can help you in identifying the best suitable wooden or tile floor for your building.',
    keyFeatures: [
      'Provides a durable floor',
      'Can be laid for indoor and outdoor',
      'Quick Installation',
      'Adds aesthetic for your living',
    ],
  },
  {
    id: '1634dbed-9fd0-4a57-bdc0-3461cd51d878',
    name: 'Home Lift Solutions',
    category: { name: 'Home Lift Solutions' },
    description:
      "Experience the ultimate in-home convenience with BNM's home lift solutions. Our expert team provides seamless installation, maintenance, and repair services.",
    keyFeatures: [
      'Customizable Designs',
      'Safety Features',
      'Smooth and Quiet Ride',
      'Low Maintenance',
    ],
  },
  {
    id: 'fb51fd72-fee6-459d-b8c4-b9251fe65938',
    name: 'Air Conditioning',
    category: { name: 'Air Conditioning' },
    description:
      'The New Generation VRF machines is a centralized air conditioning system takes care of your Cooling & IAQ.',
    keyFeatures: [
      'Centralised Touch Controller',
      'Compatible to Home Automation',
      'Remote Monitoring',
    ],
  },
  {
    id: 'c164196c-c14a-4055-baaa-e04a7760f999',
    name: 'Home Automation',
    category: { name: 'Home Automation' },
    description:
      'Gives us complete control over every aspect of your home at our fingertips prioritizing convenience and energy efficiency benefits.',
    keyFeatures: [
      'Centralised Touch Controller',
      'Controls Lights/AC/Blinds/Pumps',
      'Remotely control using Cell Phones',
      'Easy Maintenance',
    ],
  },
  {
    id: 'b9db6be1-df7e-404c-8d27-94877883fdad',
    name: 'Rooftop Solar Panels & Inverters',
    category: { name: 'Rooftop Solar Panels & Inverters' },
    description:
      'Sustainable energy solutions which saves your money also saves our nature from carbon footprint.',
    keyFeatures: [
      'Customized installation',
      'Mobile based energy management',
      'Long term warranty',
    ],
  },
  {
    id: '021181d4-2917-4ed4-ad2f-fd49d57255b9',
    name: 'Home Theatre',
    category: { name: 'Home Theatre' },
    description:
      'UHD/4K Atmos with latest theatre effects and ambience customizable based on requirements.',
    keyFeatures: [
      'Latest Picture/Projection technology (4K)',
      'Dolby Atmos - 7.1 Ch',
      'JBL, Sound Core',
    ],
  },
  {
    id: 'cdcb88d8-d14c-4a9a-b26d-ae6e8032359d',
    name: 'UPS, Batteries & Servo Stabilizers',
    category: { name: 'UPS, Batteries & Servo Stabilizers' },
    description:
      'Latest technology online UPS and low noise Generator sets to suit the customer requirement.',
    keyFeatures: [
      'Customized UPS based on backup',
      'Low noise and low emission gensets',
      '24 x 7 Customer support',
    ],
  },
  {
    id: '39be113a-2b3c-4194-98cf-1ba4f362263b',
    name: 'Gensets',
    category: { name: 'Gensets' },
    description:
      'Our Gensets deliver reliable, fuel-efficient power for homes, businesses, and industries.',
    keyFeatures: [
      'Uninterrupted Power Supply',
      'Low Noise Operation',
      'Wide Capacity Range',
      'Durable Build',
    ],
  },
  {
    id: '9c534b7c-d89d-4217-83f5-2067e22b2d47',
    name: 'CCTV & Security',
    category: { name: 'CCTV & Security' },
    description:
      'IP based new generation CCTV system using high resolution cameras and controlled door access system.',
    keyFeatures: [
      'Choice of Cameras',
      'Customized Storage facility',
      'Easy Maintenance',
      'Real time access from anywhere',
    ],
  },
  {
    id: 'f772a0d6-5b51-4d58-8e06-f0a08117c1ec',
    name: 'Fire Alarm System',
    category: { name: 'Fire Alarm System' },
    description:
      'Addressable Fire Alarm technology complying with local Civil Defense requirements.',
    keyFeatures: [
      'Central Panel',
      'Multi use sensors',
      'Third party interface',
      'Easy Maintenance',
    ],
  },
  {
    id: '55d5a6c5-9d5f-403b-be2e-07108b838481',
    name: 'Brick N Mortar',
    category: { name: 'Brick N Mortar' },
    description:
      'Comprehensive turnkey civil construction, renovation, architectural designs, and project management.',
    keyFeatures: [
      'Turnkey Building',
      'Architectural Design',
      'Project Supervision',
    ],
  },
  {
    id: 'ff1fc3d1-4d9d-4328-8549-6106df24de36',
    name: 'PEB & Structural Works',
    category: { name: 'PEB & Structural Works' },
    description:
      'Transform your construction vision with our expert PEB and structural works services. From concept to completion, we deliver high-performance steel structures.',
    keyFeatures: [
      'Custom PEB Design & Fabrication',
      'Structural Steel Erection',
      'Industrial & Commercial Sheds',
      'Mezzanine Floors & Platforms',
    ],
  },
  {
    id: '1238e244-a5dc-4e04-984b-07c6f4193c3b',
    name: 'Wooden Flooring',
    category: { name: 'Wooden Flooring' },
    description:
      'Our team of experts can help you in identifying the best suitable wooden floor for your building.',
    keyFeatures: [
      'Provides a durable floor',
      'Can be laid for indoor and outdoor',
      'Quick Installation',
      'Adds aesthetic for your living',
    ],
  },
];

@Injectable()
export class CatalogFetcherService {
  private readonly logger = new Logger(CatalogFetcherService.name);
  private readonly endpoint: string;
  private cachedServices: CatalogServiceItem[] | null = null;
  private lastFetchTime = 0;
  private readonly ttlMs = 10 * 60 * 1000; // 10 minutes cache TTL

  constructor(config: ConfigService) {
    this.endpoint =
      config.get<string>('BNM_CATALOG_SERVICE_URL') ??
      'https://bnm-api-dev.azure-api.net/bnm-service/service';
  }

  /**
   * Fetches the live service catalog from the configured endpoint.
   * Returns cached data if within TTL, or falls back to built-in catalog on network failure.
   */
  async fetchCatalog(): Promise<CatalogServiceItem[]> {
    const now = Date.now();
    if (this.cachedServices && now - this.lastFetchTime < this.ttlMs) {
      return this.cachedServices;
    }

    try {
      this.logger.debug(
        `Fetching live service catalog from ${this.endpoint}...`,
      );
      const response = await axios.get<CatalogServiceItem[]>(this.endpoint, {
        timeout: 8000,
        headers: { Accept: 'application/json' },
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        this.cachedServices = response.data.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category
            ? {
                id: item.category.id,
                name: item.category.name,
                description: item.category.description,
              }
            : undefined,
          description: item.description,
          keyFeatures: Array.isArray(item.keyFeatures) ? item.keyFeatures : [],
        }));
        this.lastFetchTime = now;
        this.logger.log(
          `Successfully fetched ${this.cachedServices.length} services from live catalog.`,
        );
        return this.cachedServices;
      }

      this.logger.warn(
        'Catalog endpoint returned an empty or invalid array. Using fallback.',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to fetch live service catalog from ${this.endpoint}: ${msg}. Using fallback.`,
      );
    }

    // Return cached if available, otherwise built-in fallback
    if (!this.cachedServices) {
      this.cachedServices = FALLBACK_CATALOG_SERVICES;
      this.lastFetchTime = now;
    }

    return this.cachedServices;
  }

  /**
   * Formats the catalog services into a structured text representation for prompt injection.
   */
  formatCatalogForPrompt(services: CatalogServiceItem[]): string {
    return services
      .map((s, index) => {
        const cat = s.category?.name || 'Unspecified';
        const desc = s.description ? s.description.replace(/\s+/g, ' ').trim() : 'N/A';
        const features =
          s.keyFeatures && s.keyFeatures.length > 0
            ? s.keyFeatures.slice(0, 5).join(', ')
            : 'Standard';
        return `[Service ${index + 1}] ID: "${s.id}" | Name: "${s.name}" | Category: "${cat}"\n  Description: ${desc}\n  Key Features: ${features}`;
      })
      .join('\n\n');
  }
}
