import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProductContextProvider implements OnModuleInit {
  private readonly logger = new Logger(ProductContextProvider.name);
  private cachedContext = '';

  onModuleInit(): void {
    this.loadProductKnowledge();
  }

  async getContext(): Promise<string> {
    return this.cachedContext;
  }

  private loadProductKnowledge(): void {
    const knowledgeDir =
      process.env.PRODUCT_KNOWLEDGE_PATH ??
      path.resolve(process.cwd(), 'docs', 'product-knowledge');

    try {
      if (!fs.existsSync(knowledgeDir)) {
        this.logger.warn(
          { knowledgeDir },
          'Product knowledge directory not found — AI product context will be empty',
        );
        return;
      }

      const files = fs
        .readdirSync(knowledgeDir)
        .filter((f) => f.endsWith('.md'))
        .sort();

      const sections: string[] = ['## Product Knowledge'];
      for (const file of files) {
        const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
        sections.push(content.trim());
      }

      this.cachedContext = sections.join('\n\n');
      this.logger.log({ fileCount: files.length }, 'Product knowledge loaded');
    } catch (err) {
      this.logger.error({ err }, 'Failed to load product knowledge');
    }
  }
}
