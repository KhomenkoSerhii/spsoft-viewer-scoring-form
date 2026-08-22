import type { BridgeWindow, ViewerBridgeServices } from './types';
import { createViewerBridgeExtension } from './index';

function createHarness() {
  const lifecycleController = {
    dispose: jest.fn(),
    enterMode: jest.fn(),
    exitMode: jest.fn(),
    install: jest.fn(),
  };
  const controllerFactory = jest.fn(() => lifecycleController);
  const commandsManager = { runCommand: jest.fn() };
  const warn = jest.fn();
  const bridgeWindow = {
    parent: { postMessage: jest.fn() },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  } satisfies BridgeWindow;
  const services = {
    viewportGridService: {
      EVENTS: {},
      getState: jest.fn(() => ({ viewports: { size: 0 } })),
      subscribe: jest.fn(),
    },
    toolGroupService: {
      EVENTS: {},
      getToolGroup: jest.fn(),
      subscribe: jest.fn(),
    },
  } as unknown as ViewerBridgeServices;
  const extension = createViewerBridgeExtension({
    controllerFactory,
    createId: () => 'generated-id',
    getBridgeWindow: () => bridgeWindow,
    warn,
  });

  return {
    bridgeWindow,
    commandsManager,
    controllerFactory,
    extension,
    lifecycleController,
    services,
    warn,
  };
}

describe('viewer bridge extension lifecycle', () => {
  it('uses appConfig when OHIF registers the extension through a mode dependency', () => {
    const {
      bridgeWindow,
      commandsManager,
      controllerFactory,
      extension,
      lifecycleController,
      services,
    } = createHarness();

    extension.preRegistration({
      appConfig: { spsoftViewerBridge: { hostOrigin: 'http://localhost:5173/' } },
      commandsManager,
      configuration: {},
      servicesManager: { services },
    });
    extension.onModeEnter();
    extension.onModeExit();

    expect(controllerFactory).toHaveBeenCalledWith({
      bridgeWindow,
      commandsManager,
      hostOrigin: 'http://localhost:5173',
      services,
      createId: expect.any(Function),
      onCommandError: expect.any(Function),
    });
    expect(lifecycleController.install).toHaveBeenCalledTimes(1);
    expect(lifecycleController.enterMode).toHaveBeenCalledTimes(1);
    expect(lifecycleController.exitMode).toHaveBeenCalledTimes(1);
  });

  it('prefers an explicit extension configuration override', () => {
    const { commandsManager, controllerFactory, extension, services } = createHarness();

    extension.preRegistration({
      appConfig: { spsoftViewerBridge: { hostOrigin: 'http://localhost:5173' } },
      commandsManager,
      configuration: { hostOrigin: 'https://host.example' },
      servicesManager: { services },
    });

    expect(controllerFactory).toHaveBeenCalledWith(
      expect.objectContaining({ hostOrigin: 'https://host.example' })
    );
  });

  it('disables the optional bridge without throwing when configuration is missing', () => {
    const { commandsManager, controllerFactory, extension, services, warn } = createHarness();

    expect(() =>
      extension.preRegistration({
        commandsManager,
        configuration: {},
        servicesManager: { services },
      })
    ).not.toThrow();
    expect(() => extension.onModeEnter()).not.toThrow();

    expect(controllerFactory).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Viewer bridge is disabled because it could not be initialized.',
      expect.any(TypeError)
    );
  });

  it('does not retain a controller whose installation fails', () => {
    const { commandsManager, controllerFactory, extension, lifecycleController, services, warn } =
      createHarness();
    lifecycleController.install.mockImplementation(() => {
      throw new Error('OHIF services are unavailable.');
    });

    expect(() =>
      extension.preRegistration({
        appConfig: { spsoftViewerBridge: { hostOrigin: 'http://localhost:5173' } },
        commandsManager,
        servicesManager: { services },
      })
    ).not.toThrow();
    extension.onModeEnter();

    expect(controllerFactory).toHaveBeenCalledTimes(1);
    expect(lifecycleController.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycleController.enterMode).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Viewer bridge is disabled because it could not be initialized.',
      expect.any(Error)
    );
  });

  it('disposes the previous controller before applying a new registration', () => {
    const { commandsManager, extension, lifecycleController, services } = createHarness();
    const params = {
      appConfig: { spsoftViewerBridge: { hostOrigin: 'http://localhost:5173' } },
      commandsManager,
      servicesManager: { services },
    };

    extension.preRegistration(params);
    extension.preRegistration(params);

    expect(lifecycleController.dispose).toHaveBeenCalledTimes(1);
  });
});
