import { chromium, type Browser, type Page } from 'playwright';
import sparticuzChromium from '@sparticuz/chromium';

let browserPromise: Promise<Browser> | undefined;

export function getBrowser() {
  browserPromise ??= (async () => {
    const isVercel = Boolean(process.env.VERCEL);
    const executablePath = process.env.CHROME_PATH || (isVercel
      ? await sparticuzChromium.executablePath()
      : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
    return chromium.launch({
      headless: true,
      executablePath,
      args: isVercel ? sparticuzChromium.args : ['--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  })().catch((error) => {
    browserPromise = undefined;
    throw error;
  });
  return browserPromise;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>) {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith('data:') ? route.continue() : route.abort());
  try { return await fn(page); }
  finally { await context.close(); }
}

export async function closeBrowser() {
  const browser = await browserPromise?.catch(() => undefined);
  await browser?.close();
  browserPromise = undefined;
}
