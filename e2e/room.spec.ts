import { expect, test } from '@playwright/test';

test('two participants can join and exchange a chat message', async ({ browser, page }) => {
  await page.goto('/');
  await page.locator('#share-button').click();
  await expect(page.locator('#room')).toBeVisible();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('#room')).toBeVisible();
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator('[data-participant-count]').first()).toContainText('2 participants', { timeout: 20_000 });

  await viewer.locator('[data-chat-input]').fill('hello from the browser test');
  await viewer.locator('[data-chat-input]').press('Enter');
  await expect(page.locator('[data-chat-messages]')).toContainText('hello from the browser test', { timeout: 10_000 });
  await expect(page.locator('#notification-toaster')).toContainText('hello from the browser test');
  await viewerContext.close();
});

test('lossless text mode renders a multi-chunk frame pixel-exactly', async ({ browser, page }) => {
  await page.goto('/');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });

  await page.locator('#quality-button').click();
  await page.locator('[data-quality="text"]').click();
  await expect(page.locator('#quality-label')).toHaveText('Text');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    const image = context.createImageData(canvas.width, canvas.height);
    for (let offset = 0; offset < image.data.length; offset += 65_536) {
      crypto.getRandomValues(image.data.subarray(offset, Math.min(image.data.length, offset + 65_536)));
    }
    for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255;
    context.putImageData(image, 0, 0);
    const stream = canvas.captureStream(6);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => stream });
    (window as unknown as { textTestStream: MediaStream }).textTestStream = stream;
  });

  await page.locator('#stream-button').click();
  const remoteCard = viewer.locator('.stream-card');
  const remoteCanvas = remoteCard.locator('canvas');
  await expect(remoteCard).not.toHaveClass(/connecting/, { timeout: 30_000 });
  await expect(remoteCanvas).toHaveJSProperty('width', 1280);
  await expect(remoteCanvas).toHaveJSProperty('height', 720);

  const publisherHash = await pixelHash(page.locator('.stream-card video'));
  const viewerHash = await pixelHash(remoteCanvas);
  expect(viewerHash).toBe(publisherHash);
  await viewerContext.close();
});

test('landing page does not overflow a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#landing')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

async function pixelHash(locator: import('@playwright/test').Locator) {
  return locator.evaluate(async (source: HTMLCanvasElement | HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(source, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  });
}
