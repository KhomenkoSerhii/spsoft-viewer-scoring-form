import { expect, test } from '@playwright/test';

interface CapturedBridgeMessage {
  origin: string;
  data: {
    type?: string;
    payload?: Record<string, unknown>;
  };
}

interface CornerstoneWindow extends Window {
  cornerstone?: {
    getRenderingEngines(): Array<{
      getViewports(): Array<{ getCurrentImageId(): string | undefined }>;
    }>;
  };
  cornerstoneTools?: {
    ToolGroupManager: {
      getAllToolGroups(): Array<{ getActivePrimaryMouseButtonTool(): string | undefined }>;
    };
  };
}

test('host activates Ellipse in OHIF and cancels drawing', async ({ page }) => {
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
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return cornerstoneWindow.cornerstone
            ?.getRenderingEngines()
            .flatMap(engine => engine.getViewports())
            .some(viewport => Boolean(viewport.getCurrentImageId()));
        }),
      { timeout: 180_000 }
    )
    .toBe(true);

  await expect(viewerFrame.locator('.shepherd-element')).toHaveCount(0);
  await expect(viewerFrame.locator('[data-cy="confirm-and-hide-button"]')).toHaveCount(0);

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

  await expect(page.getByText('Viewer підключено')).toBeVisible();

  await page.getByRole('button', { name: 'Додати вимірювання' }).click();
  const measurementRow = page.getByRole('article').first();
  await expect(measurementRow.getByText('Очікує')).toBeVisible();

  await measurementRow.getByRole('button', { name: 'Активувати Ellipse' }).click();
  await expect(measurementRow.getByText('Малювання…')).toBeVisible();

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const bridgeWindow = window as Window & {
            __spsoftBridgeMessages: CapturedBridgeMessage[];
          };
          return bridgeWindow.__spsoftBridgeMessages.find(
            message =>
              message.origin === 'http://localhost:5173' && message.data?.type === 'ACTIVATE_TOOL'
          );
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({
      origin: 'http://localhost:5173',
      data: {
        type: 'ACTIVATE_TOOL',
        payload: {
          toolName: 'EllipticalROI',
        },
      },
    });

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return cornerstoneWindow.cornerstoneTools?.ToolGroupManager.getAllToolGroups().some(
            toolGroup => toolGroup.getActivePrimaryMouseButtonTool() === 'EllipticalROI'
          );
        }),
      { timeout: 30_000 }
    )
    .toBe(true);

  await measurementRow.getByRole('button', { name: 'Скасувати' }).click();
  await expect(measurementRow.getByText('Очікує')).toBeVisible();

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const bridgeWindow = window as Window & {
            __spsoftBridgeMessages: CapturedBridgeMessage[];
          };
          return bridgeWindow.__spsoftBridgeMessages.find(
            message =>
              message.origin === 'http://localhost:5173' && message.data?.type === 'DEACTIVATE_TOOL'
          );
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({
      origin: 'http://localhost:5173',
      data: {
        type: 'DEACTIVATE_TOOL',
        payload: { reason: 'user-cancelled' },
      },
    });

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return cornerstoneWindow.cornerstoneTools?.ToolGroupManager.getAllToolGroups().some(
            toolGroup => toolGroup.getActivePrimaryMouseButtonTool() === 'Pan'
          );
        }),
      { timeout: 30_000 }
    )
    .toBe(true);

  await expect(viewerFrame.getByText('Uncaught runtime errors:')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
