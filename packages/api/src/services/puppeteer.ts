/**
 * Puppeteer PDF generation service.
 *
 * Maintains a singleton browser instance that is reused across requests.
 * Each PDF generation gets a new page (tab) which is closed after use.
 * The browser auto-relaunches if it disconnects.
 */

import puppeteer, { type Browser } from "puppeteer";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;

  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
    ],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });

  browser.on("disconnected", () => {
    browser = null;
  });

  return browser;
}

export interface PdfOptions {
  headerTemplate?: string;
  footerTemplate?: string;
}

/**
 * Generate a PDF from an HTML string using Puppeteer.
 * Returns the PDF as a Buffer.
 */
export async function generatePdf(
  html: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const start = Date.now();
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
      displayHeaderFooter: true,
      headerTemplate:
        options.headerTemplate ??
        '<div style="font-size:9px; text-align:center; width:100%;"></div>',
      footerTemplate:
        options.footerTemplate ??
        '<div style="font-size:9px; text-align:center; width:100%;"><span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });

    const elapsed = Date.now() - start;
    console.log(`PDF generated in ${elapsed}ms (${pdf.length} bytes)`);

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/**
 * Check if the browser is alive and connected.
 */
export function isBrowserAlive(): boolean {
  return browser?.connected ?? false;
}

/**
 * Close the browser for graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browser?.connected) {
    await browser.close();
    browser = null;
  }
}
