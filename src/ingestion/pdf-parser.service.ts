import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { PageText } from './chunking.service';

const pdfParse = require('pdf-parse');

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  async parseToPages(filePath: string): Promise<PageText[]> {
    const buffer = await fs.readFile(filePath);
    const pages: PageText[] = [];
    let currentPage = 0;

    await pdfParse(buffer, {
      pagerender: (pageData: any) => {
        currentPage += 1;
        const pageNumber = currentPage;

        return pageData
          .getTextContent()
          .then((textContent: any) => {
            const text = textContent.items
              .map((item: any) => item.str)
              .join(' ');

            pages.push({ pageNumber, text });
            return text;
          });
      },
    });

    this.logger.log(`Parsed ${pages.length} pages from PDF`);
    return pages;
  }
}