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
    annotation: {
      state: {
        getAllAnnotations(): Array<{ metadata?: { toolName?: string } }>;
      };
    };
    ToolGroupManager: {
      getAllToolGroups(): Array<{ getActivePrimaryMouseButtonTool(): string | undefined }>;
    };
  };
}

test('host correlates ellipses, ignores unarmed tools, and resets after reload', async ({
  page,
}) => {
  test.setTimeout(300_000);
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

  await measurementRow.getByRole('button', { name: 'Активувати Ellipse' }).click();
  await expect(measurementRow.getByText('Малювання…')).toBeVisible();

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

  const activeViewport = viewerFrame
    .locator('[data-cy="viewport-pane"][data-is-active="true"]')
    .first();
  const viewportBox = await activeViewport.boundingBox();

  if (!viewportBox) {
    throw new Error('Active OHIF viewport has no bounding box.');
  }

  await activeViewport.click({
    position: { x: viewportBox.width * 0.42, y: viewportBox.height * 0.4 },
  });
  await activeViewport.click({
    position: { x: viewportBox.width * 0.56, y: viewportBox.height * 0.52 },
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
              message.origin === 'http://localhost:3000' &&
              message.data?.type === 'MEASUREMENT_ADDED'
          );
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({
      origin: 'http://localhost:3000',
      data: {
        type: 'MEASUREMENT_ADDED',
        payload: {
          annotationId: expect.any(String),
          measurement: {
            kind: 'area',
            value: expect.any(Number),
            unit: 'mm2',
            rawUnit: 'mm²',
          },
        },
      },
    });

  await expect(measurementRow.getByText('Готово')).toBeVisible();
  await expect(measurementRow.locator('output')).toContainText('mm²');
  await expect(measurementRow.getByRole('button')).toHaveCount(0);
  await expect(page.locator('.scoring-total output')).toHaveText('—');

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

  const correlatedMessageCount = await page.evaluate(() => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    return bridgeWindow.__spsoftBridgeMessages.filter(
      message =>
        message.origin === 'http://localhost:3000' && message.data?.type === 'MEASUREMENT_ADDED'
    ).length;
  });

  await viewerFrame.locator('[data-cy="MeasurementTools-split-button-secondary"] button').click();
  const ellipseToolbarButton = viewerFrame.getByRole('menuitem', { name: 'Ellipse' });
  await expect(ellipseToolbarButton).toBeVisible({ timeout: 10_000 });
  await ellipseToolbarButton.click();

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

  await activeViewport.click({
    position: { x: viewportBox.width * 0.3, y: viewportBox.height * 0.3 },
  });
  await activeViewport.click({
    position: { x: viewportBox.width * 0.38, y: viewportBox.height * 0.38 },
  });

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return (
            cornerstoneWindow.cornerstoneTools?.annotation.state
              .getAllAnnotations()
              .filter(annotation => annotation.metadata?.toolName === 'EllipticalROI').length ?? 0
          );
        }),
      { timeout: 30_000 }
    )
    .toBe(2);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const bridgeWindow = window as Window & {
          __spsoftBridgeMessages: CapturedBridgeMessage[];
        };
        return bridgeWindow.__spsoftBridgeMessages.filter(
          message =>
            message.origin === 'http://localhost:3000' && message.data?.type === 'MEASUREMENT_ADDED'
        ).length;
      })
    )
    .toBe(correlatedMessageCount);

  await page.evaluate(() => {
    const observedWindow = window as Window & { __spsoftConnectionStates: string[] };
    observedWindow.__spsoftConnectionStates = [];
    const recordConnectionState = () => {
      const label = document.querySelector('.connection-state')?.textContent?.trim();

      if (label) {
        observedWindow.__spsoftConnectionStates.push(label);
      }
    };
    const observer = new MutationObserver(recordConnectionState);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    recordConnectionState();
  });
  await viewerFrame.locator('body').evaluate(() => window.location.reload());
  await expect(measurementRow.getByText('Очікує')).toBeVisible();
  await expect(measurementRow.locator('output')).toHaveText('—');

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
          const sessionIds = bridgeWindow.__spsoftBridgeMessages.flatMap(message =>
            message.origin === 'http://localhost:3000' &&
            message.data?.type === 'VIEWER_READY' &&
            typeof message.data.payload?.viewerInstanceId === 'string'
              ? [message.data.payload.viewerInstanceId]
              : []
          );
          return new Set(sessionIds).size;
        }),
      { timeout: 180_000 }
    )
    .toBe(2);

  await expect(page.getByText('Viewer підключено')).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __spsoftConnectionStates: string[] }).__spsoftConnectionStates
    )
  ).toContain('Підключення до Viewer…');
  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return (
            cornerstoneWindow.cornerstoneTools?.annotation.state
              .getAllAnnotations()
              .filter(annotation => annotation.metadata?.toolName === 'EllipticalROI').length ?? 0
          );
        }),
      { timeout: 30_000 }
    )
    .toBe(0);

  await expect(viewerFrame.getByText('Uncaught runtime errors:')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
