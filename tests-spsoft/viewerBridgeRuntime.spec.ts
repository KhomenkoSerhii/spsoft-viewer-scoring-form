import { expect, test } from '@playwright/test';

interface CapturedBridgeMessage {
  origin: string;
  data: {
    type?: string;
    payload?: {
      viewerInstanceId?: string;
    };
  };
}

test('host renders OHIF and receives VIEWER_READY', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));

  await page.addInitScript(() => {
    const capturedMessages: unknown[] = [];
    Object.defineProperty(window, '__spsoftBridgeMessages', {
      value: capturedMessages,
      configurable: false,
      writable: false,
    });
    window.addEventListener('message', event => {
      capturedMessages.push({ origin: event.origin, data: event.data });
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const viewerFrame = page.frameLocator('iframe[title="OHIF medical image viewer"]');
  await expect(viewerFrame.locator('[data-cy="viewport-pane"]').first()).toBeVisible({
    timeout: 180_000,
  });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bridgeWindow = window as Window & {
            __spsoftBridgeMessages: CapturedBridgeMessage[];
          };
          return bridgeWindow.__spsoftBridgeMessages.find(
            message =>
              message.origin === 'http://localhost:3000' && message.data?.type === 'VIEWER_READY'
          );
        }),
      { timeout: 180_000 }
    )
    .toMatchObject({
      origin: 'http://localhost:3000',
      data: {
        type: 'VIEWER_READY',
        payload: { viewerInstanceId: expect.any(String) },
      },
    });

  await expect(viewerFrame.getByText('Uncaught runtime errors:')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
