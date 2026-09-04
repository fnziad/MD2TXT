import { chromium, type Browser, type Page } from 'playwright-core';
import * as sparticuzChromium from '@sparticuz/chromium';

let browserPromise: Promise<Browser> | undefined;

export function getBrowser() {
  browserPromise ??= (async () => {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const chromiumRuntime = ((sparticuzChromium as any).default ?? sparticuzChromium) as {
      executablePath: (input?: string) => Promise<string>;
      args: string[];
      setGraphicsMode?: boolean;
    };

    let executablePath = process.env.CHROME_PATH;
    if (!executablePath && isServerless) {
      if ('setGraphicsMode' in chromiumRuntime) {
        chromiumRuntime.setGraphicsMode = false;
      }
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const packUrl = process.env.CHROMIUM_PACK_URL || `https://github.com/Sparticuz/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.${arch}.tar`;
      executablePath = await chromiumRuntime.executablePath(packUrl);
    } else if (!executablePath && process.platform === 'darwin') {
      executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    return chromium.launch({
      headless: true,
      executablePath,
      args: isServerless ? chromiumRuntime.args : ['--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  })().catch((error) => {
    browserPromise = undefined;
    throw error;
  });
  return browserPromise;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>) {
  const browser = await getBrowser();
  let context;
  try {
    context = await browser.newContext({ javaScriptEnabled: false, deviceScaleFactor: 3 });
  } catch (error) {
    browserPromise = undefined;
    throw error;
  }
  const page = await context.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith('data:') ? route.continue() : route.abort());
  try {
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  const browser = await browserPromise?.catch(() => undefined);
  await browser?.close().catch(() => {});
  browserPromise = undefined;
}

