import { expect, test, type FrameLocator, type Locator } from '@playwright/test';

interface CapturedBridgeMessage {
  origin: string;
  data: {
    type?: string;
    payload?: Record<string, unknown>;
  };
}

interface CornerstoneWindow extends Window {
  services?: {
    measurementService?: {
      getMeasurements(): Array<{ uid?: string }>;
      remove(measurementId: string): void;
    };
  };
  cornerstone?: {
    getRenderingEngines(): Array<{
      getViewports(): Array<{
        getCurrentImageId(): string | undefined;
        getImageIds(): string[];
        setImageIdIndex(imageIdIndex: number): Promise<void>;
        worldToCanvas(point: number[]): [number, number];
      }>;
    }>;
  };
  cornerstoneTools?: {
    annotation: {
      state: {
        getAllAnnotations(): Array<{
          annotationUID?: string;
          data?: { handles?: { points?: number[][] } };
          metadata?: { toolName?: string };
        }>;
      };
    };
    ToolGroupManager: {
      getAllToolGroups(): Array<{ getActivePrimaryMouseButtonTool(): string | undefined }>;
    };
  };
}

async function activateAndDrawMeasurement(
  measurementRow: Locator,
  viewerFrame: FrameLocator,
  activeViewport: Locator,
  toolName: 'EllipticalROI' | 'Length',
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const activationLabel = toolName === 'EllipticalROI' ? 'Активувати Ellipse' : 'Активувати Length';
  await measurementRow.getByRole('button', { name: activationLabel }).click();
  await expect(measurementRow.getByText('Малювання…')).toBeVisible();

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return (
            cornerstoneWindow.cornerstoneTools?.ToolGroupManager.getAllToolGroups().map(toolGroup =>
              toolGroup.getActivePrimaryMouseButtonTool()
            ) ?? []
          );
        }),
      { timeout: 30_000 }
    )
    .toContain(toolName);

  const viewportBox = await activeViewport.boundingBox();

  if (!viewportBox) {
    throw new Error('Active OHIF viewport has no bounding box.');
  }

  await activeViewport.click({
    position: { x: viewportBox.width * start.x, y: viewportBox.height * start.y },
  });
  await activeViewport.click({
    position: { x: viewportBox.width * end.x, y: viewportBox.height * end.y },
  });
  await expect(measurementRow.getByText('Готово')).toBeVisible({ timeout: 30_000 });

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

  await page.getByRole('button', { name: 'Додати площу' }).click();
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

  const activeViewport = viewerFrame
    .locator('[data-cy="viewport-pane"][data-is-active="true"]')
    .first();
  await activateAndDrawMeasurement(
    measurementRow,
    viewerFrame,
    activeViewport,
    'EllipticalROI',
    { x: 0.42, y: 0.4 },
    { x: 0.56, y: 0.52 }
  );

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
  await expect(measurementRow.getByRole('button', { name: 'Видалити' })).toBeVisible();

  const firstAnnotationId = await viewerFrame.locator('body').evaluate(() => {
    const cornerstoneWindow = window as CornerstoneWindow;
    return cornerstoneWindow.cornerstoneTools?.annotation.state
      .getAllAnnotations()
      .find(annotation => annotation.metadata?.toolName === 'EllipticalROI')?.annotationUID;
  });

  if (!firstAnnotationId) {
    throw new Error('Could not resolve the first correlated ellipse annotation.');
  }

  const measurementServiceIds = await viewerFrame.locator('body').evaluate(() => {
    const cornerstoneWindow = window as CornerstoneWindow;
    return (
      cornerstoneWindow.services?.measurementService
        ?.getMeasurements()
        .map(measurement => measurement.uid) ?? []
    );
  });
  expect(measurementServiceIds).toContain(firstAnnotationId);

  const annotationImageId = await viewerFrame.locator('body').evaluate(async () => {
    const cornerstoneWindow = window as CornerstoneWindow;
    const viewport = cornerstoneWindow.cornerstone
      ?.getRenderingEngines()
      .flatMap(engine => engine.getViewports())
      .find(item => Boolean(item.getCurrentImageId()));

    if (!viewport) {
      throw new Error('Could not resolve the active viewport for focus navigation.');
    }

    const currentImageId = viewport.getCurrentImageId();
    const otherImageIndex = viewport.getImageIds().findIndex(imageId => imageId !== currentImageId);

    if (!currentImageId || otherImageIndex < 0) {
      throw new Error('Focus navigation needs at least two images in the active stack.');
    }

    await viewport.setImageIdIndex(otherImageIndex);
    return currentImageId;
  });

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return cornerstoneWindow.cornerstone
            ?.getRenderingEngines()
            .flatMap(engine => engine.getViewports())
            .find(item => Boolean(item.getCurrentImageId()))
            ?.getCurrentImageId();
        }),
      { timeout: 30_000 }
    )
    .not.toBe(annotationImageId);

  await measurementRow.getByRole('button', { name: 'Показати вимірювання 1 у Viewer' }).click();

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const bridgeWindow = window as Window & {
            __spsoftBridgeMessages: CapturedBridgeMessage[];
          };
          return bridgeWindow.__spsoftBridgeMessages.filter(
            message =>
              message.origin === 'http://localhost:5173' &&
              message.data?.type === 'FOCUS_MEASUREMENT'
          ).length;
        }),
      { timeout: 30_000 }
    )
    .toBe(1);

  const focusedAnnotationId = await viewerFrame.locator('body').evaluate(() => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    const focusMessage = bridgeWindow.__spsoftBridgeMessages.find(
      message =>
        message.origin === 'http://localhost:5173' && message.data?.type === 'FOCUS_MEASUREMENT'
    );
    return focusMessage?.data.payload?.annotationId;
  });

  expect(focusedAnnotationId).toBe(firstAnnotationId);

  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return cornerstoneWindow.cornerstone
            ?.getRenderingEngines()
            .flatMap(engine => engine.getViewports())
            .find(item => Boolean(item.getCurrentImageId()))
            ?.getCurrentImageId();
        }),
      { timeout: 30_000 }
    )
    .toBe(annotationImageId);

  await expect(viewerFrame.locator(`[data-annotation-uid="${firstAnnotationId}"]`)).toBeVisible({
    timeout: 30_000,
  });

  const valueBeforeDrag = await measurementRow.locator('output').textContent();
  const updateCountBeforeDrag = await page.evaluate(() => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    return bridgeWindow.__spsoftBridgeMessages.filter(
      message =>
        message.origin === 'http://localhost:3000' && message.data?.type === 'MEASUREMENT_UPDATED'
    ).length;
  });
  const handlePosition = await viewerFrame.locator('body').evaluate(() => {
    const cornerstoneWindow = window as CornerstoneWindow;
    const annotation = cornerstoneWindow.cornerstoneTools?.annotation.state
      .getAllAnnotations()
      .find(item => item.metadata?.toolName === 'EllipticalROI');
    const handle = annotation?.data?.handles?.points?.[0];
    const viewport = cornerstoneWindow.cornerstone
      ?.getRenderingEngines()
      .flatMap(engine => engine.getViewports())
      .find(item => Boolean(item.getCurrentImageId()));

    if (!handle || !viewport) {
      throw new Error('Could not resolve an ellipse handle in the active viewport.');
    }

    const [x, y] = viewport.worldToCanvas(handle);
    return { x, y };
  });
  const firstViewportBox = await activeViewport.boundingBox();

  if (!firstViewportBox) {
    throw new Error('Active OHIF viewport has no bounding box for live update testing.');
  }

  await viewerFrame.locator('[data-cy="MeasurementTools-split-button-secondary"] button').click();
  const editEllipseToolbarButton = viewerFrame.getByRole('menuitem', { name: 'Ellipse' });
  await expect(editEllipseToolbarButton).toBeVisible({ timeout: 10_000 });
  await editEllipseToolbarButton.click();
  await page.mouse.move(
    firstViewportBox.x + handlePosition.x,
    firstViewportBox.y + handlePosition.y
  );
  await page.mouse.down();
  await page.mouse.move(
    firstViewportBox.x + handlePosition.x + 30,
    firstViewportBox.y + handlePosition.y + 20,
    { steps: 10 }
  );
  await page.mouse.up();

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bridgeWindow = window as Window & {
            __spsoftBridgeMessages: CapturedBridgeMessage[];
          };
          return bridgeWindow.__spsoftBridgeMessages.filter(
            message =>
              message.origin === 'http://localhost:3000' &&
              message.data?.type === 'MEASUREMENT_UPDATED'
          ).length;
        }),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(updateCountBeforeDrag);
  await expect(measurementRow.locator('output')).not.toHaveText(valueBeforeDrag ?? '');

  await page.getByRole('button', { name: 'Додати площу' }).click();
  const secondMeasurementRow = page.getByRole('article').nth(1);
  await activateAndDrawMeasurement(
    secondMeasurementRow,
    viewerFrame,
    activeViewport,
    'EllipticalROI',
    { x: 0.58, y: 0.28 },
    { x: 0.68, y: 0.38 }
  );

  await page.getByRole('button', { name: 'Додати площу' }).click();
  const thirdMeasurementRow = page.getByRole('article').nth(2);
  await activateAndDrawMeasurement(
    thirdMeasurementRow,
    viewerFrame,
    activeViewport,
    'EllipticalROI',
    { x: 0.3, y: 0.56 },
    { x: 0.4, y: 0.66 }
  );

  const expectedTotal = await page.evaluate(() => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    const valuesByAnnotationId = new Map<string, number>();

    for (const message of bridgeWindow.__spsoftBridgeMessages) {
      if (
        message.origin !== 'http://localhost:3000' ||
        (message.data?.type !== 'MEASUREMENT_ADDED' && message.data?.type !== 'MEASUREMENT_UPDATED')
      ) {
        continue;
      }

      const annotationId = message.data.payload?.annotationId;
      const measurement = message.data.payload?.measurement as { value?: unknown } | undefined;

      if (typeof annotationId === 'string' && typeof measurement?.value === 'number') {
        valuesByAnnotationId.set(annotationId, measurement.value);
      }
    }

    const total = [...valuesByAnnotationId.values()].reduce((sum, value) => sum + value, 0);

    return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(total)} mm²`;
  });

  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('article').getByText('Готово')).toHaveCount(3);
  await expect(page.locator('[data-total-kind="area"] output')).toHaveText(expectedTotal);
  await expect(page.locator('[data-total-kind="length"] output')).toHaveText('—');
  expect(
    await page.locator('.measurement-row').evaluateAll(rows =>
      rows.map(row => {
        const title = row.querySelector('h2');
        const value = row.querySelector('.measurement-row__value');

        if (!title || !value) {
          throw new Error('Measurement row is missing its title or value.');
        }

        const valueRange = document.createRange();
        valueRange.selectNodeContents(value);
        const valueLineTops = Array.from(valueRange.getClientRects(), rect => Math.round(rect.top));

        return {
          titleOverflows: title.scrollWidth > title.clientWidth,
          valueLines: new Set(valueLineTops).size,
        };
      })
    )
  ).toEqual([
    { titleOverflows: false, valueLines: 1 },
    { titleOverflows: false, valueLines: 1 },
    { titleOverflows: false, valueLines: 1 },
  ]);

  await page.getByRole('button', { name: 'Додати довжину' }).click();
  const lengthRow = page.getByRole('article').nth(3);
  await expect(lengthRow.getByRole('heading', { name: 'Довжина' })).toBeVisible();
  await activateAndDrawMeasurement(
    lengthRow,
    viewerFrame,
    activeViewport,
    'Length',
    { x: 0.36, y: 0.7 },
    { x: 0.58, y: 0.7 }
  );

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
              message.data?.type === 'MEASUREMENT_ADDED' &&
              (message.data.payload?.measurement as { kind?: unknown } | undefined)?.kind ===
                'length'
          );
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({
      data: {
        payload: {
          measurement: {
            kind: 'length',
            value: expect.any(Number),
            unit: 'mm',
            rawUnit: 'mm',
          },
        },
      },
    });

  const lengthValue = await lengthRow.locator('output').textContent();
  await expect(page.locator('[data-total-kind="area"] output')).toHaveText(expectedTotal);
  await expect(page.locator('[data-total-kind="length"] output')).toHaveText(lengthValue ?? '');

  const lengthAnnotationId = await viewerFrame.locator('body').evaluate(() => {
    const cornerstoneWindow = window as CornerstoneWindow;
    return cornerstoneWindow.cornerstoneTools?.annotation.state
      .getAllAnnotations()
      .find(annotation => annotation.metadata?.toolName === 'Length')?.annotationUID;
  });

  if (!lengthAnnotationId) {
    throw new Error('Could not resolve the correlated Length annotation.');
  }

  await lengthRow.getByRole('button', { name: 'Показати вимірювання 4 у Viewer' }).click();
  await expect
    .poll(() =>
      viewerFrame.locator('body').evaluate(() => {
        const bridgeWindow = window as Window & {
          __spsoftBridgeMessages: CapturedBridgeMessage[];
        };
        return bridgeWindow.__spsoftBridgeMessages.filter(
          message =>
            message.origin === 'http://localhost:5173' && message.data?.type === 'FOCUS_MEASUREMENT'
        ).length;
      })
    )
    .toBe(2);

  const focusedLengthAnnotationId = await viewerFrame.locator('body').evaluate(() => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    return bridgeWindow.__spsoftBridgeMessages
      .filter(
        message =>
          message.origin === 'http://localhost:5173' && message.data?.type === 'FOCUS_MEASUREMENT'
      )
      .at(-1)?.data.payload?.annotationId;
  });
  expect(focusedLengthAnnotationId).toBe(lengthAnnotationId);

  await lengthRow.getByRole('button', { name: 'Видалити' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.locator('[data-total-kind="length"] output')).toHaveText('—');
  await expect
    .poll(
      () =>
        viewerFrame.locator('body').evaluate(() => {
          const cornerstoneWindow = window as CornerstoneWindow;
          return (
            cornerstoneWindow.cornerstoneTools?.annotation.state
              .getAllAnnotations()
              .filter(annotation => annotation.metadata?.toolName === 'Length').length ?? 0
          );
        }),
      { timeout: 30_000 }
    )
    .toBe(0);

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

  expect(correlatedMessageCount).toBe(4);

  await thirdMeasurementRow.getByRole('button', { name: 'Видалити' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
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
      viewerFrame.locator('body').evaluate(() => {
        const bridgeWindow = window as Window & {
          __spsoftBridgeMessages: CapturedBridgeMessage[];
        };
        return bridgeWindow.__spsoftBridgeMessages.filter(
          message =>
            message.origin === 'http://localhost:5173' &&
            message.data?.type === 'REMOVE_MEASUREMENT'
        ).length;
      })
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
            message.origin === 'http://localhost:3000' &&
            message.data?.type === 'MEASUREMENT_REMOVED'
        ).length;
      })
    )
    .toBe(2);

  const viewerDeletionAnnotationId = await viewerFrame.locator('body').evaluate(() => {
    const cornerstoneWindow = window as CornerstoneWindow;
    const measurementService = cornerstoneWindow.services?.measurementService;

    if (!measurementService) {
      throw new Error('OHIF MeasurementService is unavailable.');
    }

    const annotationId = measurementService
      .getMeasurements()
      .find(measurement => typeof measurement.uid === 'string')?.uid;

    if (!annotationId) {
      throw new Error('OHIF MeasurementService has no removable correlated measurement.');
    }

    measurementService.remove(annotationId);
    return annotationId;
  });
  const viewerDeletionRowId = await page.evaluate(annotationId => {
    const bridgeWindow = window as Window & {
      __spsoftBridgeMessages: CapturedBridgeMessage[];
    };
    const addedMessage = bridgeWindow.__spsoftBridgeMessages.find(
      message =>
        message.origin === 'http://localhost:3000' &&
        message.data?.type === 'MEASUREMENT_ADDED' &&
        message.data.payload?.annotationId === annotationId
    );
    const rowId = addedMessage?.data.payload?.rowId;

    if (typeof rowId !== 'string') {
      throw new Error('The correlated row ID is missing for Viewer deletion.');
    }

    return rowId;
  }, viewerDeletionAnnotationId);
  const viewerDeletedRow = page.locator(`[data-row-id="${viewerDeletionRowId}"]`);
  await expect(viewerDeletedRow.getByText('Очікує')).toBeVisible();
  await expect(viewerDeletedRow.locator('output')).toHaveText('—');
  await expect(viewerDeletedRow.getByRole('button', { name: 'Активувати Ellipse' })).toBeVisible();
  const remainingMeasurementValue = await page
    .locator('.measurement-row--ready .measurement-row__value')
    .textContent();
  await expect(page.locator('[data-total-kind="area"] output')).toHaveText(
    remainingMeasurementValue ?? ''
  );
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
    .toBe(1);

  const viewportBox = await activeViewport.boundingBox();

  if (!viewportBox) {
    throw new Error('Active OHIF viewport has no bounding box.');
  }

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
  await expect(page.getByRole('article').getByText('Очікує')).toHaveCount(2);
  await expect(page.locator('[data-total-kind="area"] output')).toHaveText('—');
  await expect(page.locator('[data-total-kind="length"] output')).toHaveText('—');

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

test('host queues early activation and ignores malformed messages from the Viewer frame', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));

  await page.route('http://localhost:3000/viewer**', async route => {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const addMeasurementButton = page.getByRole('button', { name: 'Додати площу' });
  await expect(addMeasurementButton).toBeEnabled();
  await addMeasurementButton.click();

  const measurementRow = page.getByRole('article');
  await measurementRow.getByRole('button', { name: 'Активувати Ellipse' }).click();
  await expect(measurementRow.getByText('У черзі')).toBeVisible();

  const viewerFrame = page.frameLocator('iframe[title="OHIF medical image viewer"]');
  await expect(viewerFrame.locator('[data-cy="viewport-pane"]').first()).toBeVisible({
    timeout: 180_000,
  });
  await expect(measurementRow.getByText('Малювання…')).toBeVisible({ timeout: 180_000 });
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

  await viewerFrame.locator('body').evaluate(() => {
    const forgedReadyMessage = {
      channel: 'spsoft.viewer-bridge',
      version: 1,
      type: 'VIEWER_READY',
      messageId: 'forged-ready',
      payload: {
        viewerInstanceId: 'forged-viewer',
        supportedTools: ['EllipticalROI'],
        capabilities: {
          measurementDeletion: false,
          measurementFocus: false,
          measurementUpdates: false,
        },
      },
    };

    window.parent.postMessage(
      { ...forgedReadyMessage, channel: 'foreign.channel' },
      'http://localhost:5173'
    );
    window.parent.postMessage({ ...forgedReadyMessage, version: 2 }, 'http://localhost:5173');
  });
  await page.waitForTimeout(100);

  await expect(measurementRow.getByText('Малювання…')).toBeVisible();
  await measurementRow.getByRole('button', { name: 'Скасувати' }).click();
  await expect(measurementRow.getByText('Очікує')).toBeVisible();
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
