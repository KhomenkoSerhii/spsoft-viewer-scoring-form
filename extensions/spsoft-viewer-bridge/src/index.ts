import { parseViewerBridgeConfiguration } from './configuration';
import { id } from './id';
import type { BridgeWindow, ViewerBridgeServices } from './types';
import { ViewerPersistenceStore } from './persistence';
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
  getPersistenceOptions?: () => Pick<
    ViewerBridgeControllerOptions,
    'annotationRepository' | 'persistenceStore'
  >;
  warn?: (message: string, error: unknown) => void;
}

interface CornerstoneWindow extends Window {
  cornerstoneTools?: {
    annotation?: {
      state?: {
        addAnnotation(annotation: Record<string, unknown>): string;
        getAnnotation(annotationId: string): Record<string, unknown> | undefined;
        removeAnnotation(annotationId: string): void;
      };
    };
  };
}

function getDefaultPersistenceOptions(): Pick<
  ViewerBridgeControllerOptions,
  'annotationRepository' | 'persistenceStore'
> {
  if (typeof window === 'undefined') {
    return {};
  }

  const studyInstanceUid = new URLSearchParams(window.location.search)
    .get('StudyInstanceUIDs')
    ?.split(',')[0]
    ?.trim();

  if (!studyInstanceUid) {
    return {};
  }

  try {
    const cornerstoneWindow = window as CornerstoneWindow;
    const getAnnotationState = () => cornerstoneWindow.cornerstoneTools?.annotation?.state;

    return {
      annotationRepository: {
        add: annotation => {
          const annotationState = getAnnotationState();

          if (!annotationState) {
            throw new Error('Cornerstone annotation state is unavailable.');
          }

          return annotationState.addAnnotation(annotation);
        },
        get: annotationId => getAnnotationState()?.getAnnotation(annotationId),
        remove: annotationId => getAnnotationState()?.removeAnnotation(annotationId),
      },
      persistenceStore: new ViewerPersistenceStore(window.localStorage, studyInstanceUid),
    };
  } catch {
    return {};
  }
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
  const getPersistenceOptions = dependencies.getPersistenceOptions ?? getDefaultPersistenceOptions;
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
          ...getPersistenceOptions(),
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
