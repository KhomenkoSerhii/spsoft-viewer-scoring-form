import { parseViewerBridgeConfiguration } from './configuration';
import { id } from './id';
import type { BridgeWindow, ViewerBridgeServices } from './types';
import {
  ViewerBridgeController,
  type ViewerBridgeControllerOptions,
} from './ViewerBridgeController';

interface ExtensionParams {
  appConfig?: {
    spsoftViewerBridge?: unknown;
  };
  configuration?: unknown;
  commandsManager: ViewerBridgeControllerOptions['commandsManager'];
  servicesManager: {
    services: ViewerBridgeServices;
  };
}

interface ViewerBridgeLifecycleController {
  dispose(): void;
  enterMode(): void;
  exitMode(): void;
  install(): void;
}

interface ViewerBridgeExtensionDependencies {
  controllerFactory?: (options: ViewerBridgeControllerOptions) => ViewerBridgeLifecycleController;
  createId?: () => string;
  getBridgeWindow?: () => BridgeWindow;
  warn?: (message: string, error: unknown) => void;
}

function hasHostOrigin(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'hostOrigin')
  );
}

export function createViewerBridgeExtension(dependencies: ViewerBridgeExtensionDependencies = {}) {
  const controllerFactory =
    dependencies.controllerFactory ?? (options => new ViewerBridgeController(options));
  const getBridgeWindow = dependencies.getBridgeWindow ?? (() => window);
  const createId = dependencies.createId ?? (() => window.crypto.randomUUID());
  const warn =
    dependencies.warn ??
    ((message: string, error: unknown) => console.warn(`[${id}] ${message}`, error));
  let controller: ViewerBridgeLifecycleController | null = null;

  return {
    id,

    preRegistration({
      appConfig,
      commandsManager,
      configuration,
      servicesManager,
    }: ExtensionParams): void {
      controller?.dispose();
      controller = null;

      const resolvedConfiguration = hasHostOrigin(configuration)
        ? configuration
        : appConfig?.spsoftViewerBridge;
      let nextController: ViewerBridgeLifecycleController | null = null;

      try {
        const { hostOrigin } = parseViewerBridgeConfiguration(resolvedConfiguration);
        nextController = controllerFactory({
          bridgeWindow: getBridgeWindow(),
          commandsManager,
          hostOrigin,
          services: servicesManager.services,
          createId,
          onCommandError: error => warn('Viewer bridge command could not be applied.', error),
        });
        nextController.install();
        controller = nextController;
      } catch (error) {
        nextController?.dispose();
        // An optional integration must never prevent OHIF from rendering.
        warn('Viewer bridge is disabled because it could not be initialized.', error);
      }
    },

    onModeEnter(): void {
      controller?.enterMode();
    },

    onModeExit(): void {
      controller?.exitMode();
    },
  };
}

const viewerBridgeExtension = createViewerBridgeExtension();

export { id, parseViewerBridgeConfiguration, ViewerBridgeController };
export type { ViewerBridgeConfiguration } from './configuration';
export type { ViewerBridgeControllerOptions } from './ViewerBridgeController';
export default viewerBridgeExtension;
