import {
  BRIDGE_MESSAGE_TYPES,
  SUPPORTED_TOOLS,
  createBridgeMessage,
  isHostToViewerMessage,
  measurementMatchesTool,
  parseBridgeMessage,
  type CommandRejectionReason,
  type HostToViewerMessage,
  type Measurement,
  type MeasurementBinding,
  type RestoredMeasurement,
  type SupportedToolName,
} from '@spsoft/viewer-protocol';

import type {
  BridgeSubscription,
  BridgeWindow,
  AnnotationRepository,
  HostMessageHandler,
  ToolGroup,
  ViewerBridgeCommandsManager,
  ViewerBridgeServices,
  ViewportGridState,
} from './types';
import { ViewerPersistenceStore, type PersistedViewerMeasurement } from './persistence';
import {
  extractRemovedAnnotationId,
  extractSupportedMeasurement,
  extractSupportedMeasurementAnnotationId,
} from './measurement';

const READY_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

function measurementsMatch(
  previousMeasurement: Measurement | undefined,
  nextMeasurement: Measurement
): boolean {
  return (
    previousMeasurement?.kind === nextMeasurement.kind &&
    previousMeasurement.value === nextMeasurement.value &&
    previousMeasurement.unit === nextMeasurement.unit &&
    previousMeasurement.rawUnit === nextMeasurement.rawUnit &&
    previousMeasurement.calibrationType === nextMeasurement.calibrationType
  );
}

export interface ViewerBridgeControllerOptions {
  bridgeWindow: BridgeWindow;
  cancelActiveManipulation?: () => string | undefined;
  commandsManager: ViewerBridgeCommandsManager;
  hostOrigin: string;
  services: ViewerBridgeServices;
  createId: () => string;
  onHostMessage?: HostMessageHandler;
  onCommandError?: (error: unknown) => void;
  annotationRepository?: AnnotationRepository;
  persistenceStore?: ViewerPersistenceStore;
}

interface ArmedActivation {
  activationId: string;
  pendingAnnotationId?: string;
  rowId: string;
  toolName: SupportedToolName;
}

type RejectableHostCommand = Extract<
  HostToViewerMessage,
  {
    type:
      | typeof BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL
      | typeof BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT;
  }
>;

export class ViewerBridgeController {
  private readonly bridgeWindow: BridgeWindow;
  private readonly cancelActiveManipulation: (() => string | undefined) | undefined;
  private readonly commandsManager: ViewerBridgeCommandsManager;
  private readonly hostOrigin: string;
  private readonly services: ViewerBridgeServices;
  private readonly createId: () => string;
  private readonly onHostMessage: HostMessageHandler | undefined;
  private readonly onCommandError: ((error: unknown) => void) | undefined;
  private readonly annotationRepository: AnnotationRepository | undefined;
  private readonly persistenceStore: ViewerPersistenceStore | undefined;
  private readonly subscriptions: BridgeSubscription[] = [];
  private readonly rowIdsByAnnotationId = new Map<string, string>();
  private readonly toolNamesByAnnotationId = new Map<string, SupportedToolName>();
  private readonly lastMeasurementsByAnnotationId = new Map<string, Measurement>();
  private installed = false;
  private modeActive = false;
  private readyAnnounced = false;
  private viewerInstanceId: string | null = null;
  private readyRetryIndex = 0;
  private readyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private armedActivation: ArmedActivation | null = null;

  constructor(options: ViewerBridgeControllerOptions) {
    this.bridgeWindow = options.bridgeWindow;
    this.cancelActiveManipulation = options.cancelActiveManipulation;
    this.commandsManager = options.commandsManager;
    this.hostOrigin = options.hostOrigin;
    this.services = options.services;
    this.createId = options.createId;
    this.onHostMessage = options.onHostMessage;
    this.onCommandError = options.onCommandError;
    this.annotationRepository = options.annotationRepository;
    this.persistenceStore = options.persistenceStore;
  }

  install(): void {
    if (this.installed) {
      return;
    }

    this.bridgeWindow.addEventListener('message', this.handleMessage);
    this.bridgeWindow.addEventListener('pagehide', this.flushPersistence);

    const { measurementService, viewportGridService, toolGroupService } = this.services;
    const viewportEvents = [
      viewportGridService.EVENTS.VIEWPORTS_READY,
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    ].filter((eventName): eventName is string => typeof eventName === 'string');

    for (const eventName of viewportEvents) {
      this.subscriptions.push(viewportGridService.subscribe(eventName, this.tryAnnounceReady));
    }

    const toolGroupEvents = [
      toolGroupService.EVENTS.TOOLGROUP_CREATED,
      toolGroupService.EVENTS.VIEWPORT_ADDED,
    ].filter((eventName): eventName is string => typeof eventName === 'string');

    for (const eventName of toolGroupEvents) {
      this.subscriptions.push(toolGroupService.subscribe(eventName, this.tryAnnounceReady));
    }

    const measurementAddedEvent = measurementService.EVENTS.MEASUREMENT_ADDED;
    const measurementRemovedEvent = measurementService.EVENTS.MEASUREMENT_REMOVED;
    const measurementUpdatedEvent = measurementService.EVENTS.MEASUREMENT_UPDATED;

    if (typeof measurementAddedEvent === 'string') {
      this.subscriptions.push(
        measurementService.subscribe(measurementAddedEvent, this.handleMeasurementAdded)
      );
    }

    if (typeof measurementUpdatedEvent === 'string') {
      this.subscriptions.push(
        measurementService.subscribe(measurementUpdatedEvent, this.handleMeasurementUpdated)
      );
    }

    if (typeof measurementRemovedEvent === 'string') {
      this.subscriptions.push(
        measurementService.subscribe(measurementRemovedEvent, this.handleMeasurementRemoved)
      );
    }

    this.installed = true;
  }

  enterMode(): void {
    this.install();
    this.modeActive = true;
    this.readyAnnounced = false;
    this.viewerInstanceId = this.createId();
    this.rowIdsByAnnotationId.clear();
    this.toolNamesByAnnotationId.clear();
    this.lastMeasurementsByAnnotationId.clear();
    this.cancelReadyRetry();
    this.readyRetryIndex = 0;
    this.tryAnnounceReady();
  }

  exitMode(): void {
    this.deactivateArmedTool({ discardDraft: true });
    this.persistenceStore?.flush();
    this.modeActive = false;
    this.readyAnnounced = false;
    this.viewerInstanceId = null;
    this.rowIdsByAnnotationId.clear();
    this.toolNamesByAnnotationId.clear();
    this.lastMeasurementsByAnnotationId.clear();
    this.cancelReadyRetry();
    this.readyRetryIndex = 0;

    if (!this.installed) {
      return;
    }

    this.bridgeWindow.removeEventListener('message', this.handleMessage);
    this.bridgeWindow.removeEventListener('pagehide', this.flushPersistence);
    this.subscriptions.splice(0).forEach(subscription => subscription.unsubscribe());
    this.installed = false;
  }

  dispose(): void {
    this.exitMode();
  }

  getViewerInstanceId(): string | null {
    return this.viewerInstanceId;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (
      !this.modeActive ||
      !this.viewerInstanceId ||
      event.origin !== this.hostOrigin ||
      event.source !== this.bridgeWindow.parent
    ) {
      return;
    }

    const message = parseBridgeMessage(event.data);

    if (
      !message ||
      !isHostToViewerMessage(message) ||
      message.payload.targetViewerInstanceId !== this.viewerInstanceId
    ) {
      return;
    }

    try {
      this.executeHostCommand(message);
    } catch (error) {
      if (
        message.type === BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL ||
        message.type === BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT
      ) {
        this.publishCommandRejected(message, 'execution-failed');
      }
      this.onCommandError?.(error);
    }
    this.onHostMessage?.(message);
  };

  private readonly flushPersistence = (): void => {
    this.persistenceStore?.flush();
  };

  private readonly handleMeasurementAdded = (event: unknown): void => {
    if (!this.modeActive || !this.viewerInstanceId || !this.armedActivation) {
      return;
    }

    const annotationId = extractSupportedMeasurementAnnotationId(
      event,
      this.armedActivation.toolName
    );

    if (!annotationId) {
      return;
    }

    if (!this.armedActivation.pendingAnnotationId) {
      this.armedActivation.pendingAnnotationId = annotationId;
    }

    if (this.armedActivation.pendingAnnotationId !== annotationId) {
      return;
    }

    this.completeArmedMeasurement(event);
  };

  private readonly handleMeasurementUpdated = (event: unknown): void => {
    if (!this.modeActive || !this.viewerInstanceId) {
      return;
    }

    const annotationId = extractSupportedMeasurementAnnotationId(event);

    if (!annotationId) {
      return;
    }

    if (this.armedActivation?.pendingAnnotationId) {
      if (annotationId === this.armedActivation.pendingAnnotationId) {
        this.completeArmedMeasurement(event);
        return;
      }
    }

    const rowId = this.rowIdsByAnnotationId.get(annotationId);
    const toolName = this.toolNamesByAnnotationId.get(annotationId);
    const extractedMeasurement = toolName ? extractSupportedMeasurement(event, toolName) : null;

    if (!rowId || !toolName || !extractedMeasurement) {
      return;
    }

    if (
      measurementsMatch(
        this.lastMeasurementsByAnnotationId.get(annotationId),
        extractedMeasurement.measurement
      )
    ) {
      return;
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_UPDATED,
      {
        viewerInstanceId: this.viewerInstanceId,
        rowId,
        annotationId,
        measurement: extractedMeasurement.measurement,
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
    this.lastMeasurementsByAnnotationId.set(annotationId, extractedMeasurement.measurement);
    this.persistMeasurement(annotationId, rowId, toolName, extractedMeasurement.measurement);
  };

  private readonly handleMeasurementRemoved = (event: unknown): void => {
    if (!this.modeActive || !this.viewerInstanceId) {
      return;
    }

    const annotationId = extractRemovedAnnotationId(event);
    const rowId = annotationId ? this.rowIdsByAnnotationId.get(annotationId) : undefined;

    if (!annotationId || !rowId) {
      return;
    }

    this.rowIdsByAnnotationId.delete(annotationId);
    this.toolNamesByAnnotationId.delete(annotationId);
    this.lastMeasurementsByAnnotationId.delete(annotationId);
    this.persistenceStore?.remove(annotationId);
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_REMOVED,
      {
        viewerInstanceId: this.viewerInstanceId,
        rowId,
        annotationId,
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
  };

  private completeArmedMeasurement(event: unknown): void {
    const extractedMeasurement = this.armedActivation
      ? extractSupportedMeasurement(event, this.armedActivation.toolName)
      : null;

    if (!extractedMeasurement || !this.viewerInstanceId || !this.armedActivation) {
      return;
    }

    const { activationId, rowId, toolName } = this.armedActivation;
    this.rowIdsByAnnotationId.set(extractedMeasurement.annotationId, rowId);
    this.toolNamesByAnnotationId.set(extractedMeasurement.annotationId, toolName);
    this.lastMeasurementsByAnnotationId.set(
      extractedMeasurement.annotationId,
      extractedMeasurement.measurement
    );
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENT_ADDED,
      {
        viewerInstanceId: this.viewerInstanceId,
        rowId,
        activationId,
        annotationId: extractedMeasurement.annotationId,
        measurement: extractedMeasurement.measurement,
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
    this.persistMeasurement(
      extractedMeasurement.annotationId,
      rowId,
      toolName,
      extractedMeasurement.measurement
    );
    this.deactivateArmedTool();
  }

  private executeHostCommand(message: Parameters<HostMessageHandler>[0]): void {
    if (message.type === BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL) {
      const { activationId, rowId, toolName } = message.payload;
      const toolGroup = this.services.toolGroupService.getToolGroup();

      if (!toolGroup?.hasTool(toolName)) {
        this.publishCommandRejected(message, 'unsupported');
        return;
      }

      if (
        this.armedActivation?.rowId === rowId &&
        this.armedActivation.activationId === activationId
      ) {
        return;
      }

      this.deactivateArmedTool({ discardDraft: true });

      if (!this.setToolActive(toolName)) {
        this.publishCommandRejected(message, 'execution-failed');
        return;
      }

      this.armedActivation = { rowId, activationId, toolName };
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.RESTORE_MEASUREMENTS) {
      this.restoreMeasurements(message.payload.measurements);
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT) {
      const { annotationId, rowId } = message.payload;

      if (this.rowIdsByAnnotationId.get(annotationId) !== rowId) {
        this.publishCommandRejected(message, 'invalid-state');
        return;
      }

      if (!this.services.measurementService.getMeasurement(annotationId)) {
        this.publishCommandRejected(message, 'invalid-state');
        return;
      }

      this.services.measurementService.remove(annotationId);
      return;
    }

    if (message.type === BRIDGE_MESSAGE_TYPES.FOCUS_MEASUREMENT) {
      const { annotationId, rowId } = message.payload;

      if (this.armedActivation || this.rowIdsByAnnotationId.get(annotationId) !== rowId) {
        return;
      }

      const measurement = this.services.measurementService.getMeasurement(annotationId);

      if (!measurement) {
        return;
      }

      this.commandsManager.runCommand('jumpToMeasurementViewport', {
        annotationUID: annotationId,
        measurement,
      });
      return;
    }

    if (
      this.armedActivation?.rowId !== message.payload.rowId ||
      this.armedActivation.activationId !== message.payload.activationId
    ) {
      return;
    }

    this.deactivateArmedTool({ discardDraft: true });
  }

  private publishCommandRejected(
    message: RejectableHostCommand,
    reason: CommandRejectionReason
  ): void {
    if (!this.viewerInstanceId) {
      return;
    }

    const payload =
      message.type === BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL
        ? {
            viewerInstanceId: this.viewerInstanceId,
            command: BRIDGE_MESSAGE_TYPES.ACTIVATE_TOOL,
            rowId: message.payload.rowId,
            activationId: message.payload.activationId,
            reason,
          }
        : {
            viewerInstanceId: this.viewerInstanceId,
            command: BRIDGE_MESSAGE_TYPES.REMOVE_MEASUREMENT,
            rowId: message.payload.rowId,
            annotationId: message.payload.annotationId,
            reason,
          };
    const rejection = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.COMMAND_REJECTED,
      payload,
      this.createId()
    );

    try {
      this.bridgeWindow.parent.postMessage(rejection, this.hostOrigin);
    } catch (error) {
      this.onCommandError?.(error);
    }
  }

  private deactivateArmedTool({ discardDraft = false }: { discardDraft?: boolean } = {}): void {
    const armedActivation = this.armedActivation;

    if (!armedActivation) {
      return;
    }

    // Clear correlation first: Cornerstone's cancel API emits ANNOTATION_COMPLETED for a
    // draft, which MeasurementService exposes synchronously as MEASUREMENT_ADDED.
    this.armedActivation = null;

    if (discardDraft) {
      let draftAnnotationId = armedActivation.pendingAnnotationId;

      try {
        draftAnnotationId = this.cancelActiveManipulation?.() ?? draftAnnotationId;
      } catch (error) {
        this.onCommandError?.(error);
      }

      if (draftAnnotationId) {
        this.discardDraftMeasurement(draftAnnotationId);
      }
    }

    this.setToolActive('Pan');
  }

  private discardDraftMeasurement(annotationId: string): void {
    this.rowIdsByAnnotationId.delete(annotationId);
    this.toolNamesByAnnotationId.delete(annotationId);
    this.lastMeasurementsByAnnotationId.delete(annotationId);
    this.persistenceStore?.remove(annotationId);

    try {
      if (this.services.measurementService.getMeasurement(annotationId)) {
        this.services.measurementService.remove(annotationId);
        return;
      }

      this.annotationRepository?.remove(annotationId);
    } catch (error) {
      this.onCommandError?.(error);
    }
  }

  private persistMeasurement(
    annotationId: string,
    rowId: string,
    toolName: SupportedToolName,
    measurement: Measurement
  ): void {
    const annotation = this.annotationRepository?.get(annotationId);

    if (!annotation || !this.persistenceStore) {
      return;
    }

    this.persistenceStore.upsert({ annotation, annotationId, measurement, rowId, toolName });
  }

  private restoreMeasurements(bindings: MeasurementBinding[]): void {
    if (!this.viewerInstanceId || !this.persistenceStore || !this.annotationRepository) {
      this.publishRestoredMeasurements([]);
      return;
    }

    const expectedByAnnotationId = new Map(
      bindings.map(binding => [binding.annotationId, binding])
    );
    const storedMeasurements = this.persistenceStore.load();
    const restoredMeasurements: RestoredMeasurement[] = [];
    const retainedMeasurements: PersistedViewerMeasurement[] = [];

    for (const stored of storedMeasurements) {
      const expected = expectedByAnnotationId.get(stored.annotationId);

      if (expected?.rowId !== stored.rowId || expected.toolName !== stored.toolName) {
        if (this.annotationRepository.get(stored.annotationId)) {
          this.annotationRepository.remove(stored.annotationId);
        }
        continue;
      }

      try {
        if (!this.annotationRepository.get(stored.annotationId)) {
          this.rowIdsByAnnotationId.set(stored.annotationId, stored.rowId);
          this.toolNamesByAnnotationId.set(stored.annotationId, stored.toolName);

          if (this.annotationRepository.add(stored.annotation) !== stored.annotationId) {
            throw new Error('The restored annotation ID changed.');
          }
        }

        const serviceMeasurement = this.services.measurementService.getMeasurement(
          stored.annotationId
        );
        const extracted = extractSupportedMeasurement(
          { measurement: serviceMeasurement },
          stored.toolName
        );

        if (
          !extracted ||
          extracted.annotationId !== stored.annotationId ||
          !measurementMatchesTool(extracted.measurement, stored.toolName)
        ) {
          throw new Error('OHIF did not recreate the stored measurement.');
        }

        const annotation = this.annotationRepository.get(stored.annotationId);

        if (!annotation) {
          throw new Error('Cornerstone did not retain the restored annotation.');
        }

        this.rowIdsByAnnotationId.set(stored.annotationId, stored.rowId);
        this.toolNamesByAnnotationId.set(stored.annotationId, stored.toolName);
        this.lastMeasurementsByAnnotationId.set(stored.annotationId, extracted.measurement);
        retainedMeasurements.push({ ...stored, annotation, measurement: extracted.measurement });
        restoredMeasurements.push({
          annotationId: stored.annotationId,
          rowId: stored.rowId,
          toolName: stored.toolName,
          measurement: extracted.measurement,
        });
      } catch (error) {
        this.rowIdsByAnnotationId.delete(stored.annotationId);
        this.toolNamesByAnnotationId.delete(stored.annotationId);
        this.lastMeasurementsByAnnotationId.delete(stored.annotationId);

        if (this.annotationRepository.get(stored.annotationId)) {
          this.annotationRepository.remove(stored.annotationId);
        }

        this.onCommandError?.(error);
      }
    }

    this.persistenceStore.replace(retainedMeasurements);
    this.publishRestoredMeasurements(restoredMeasurements);
  }

  private publishRestoredMeasurements(measurements: RestoredMeasurement[]): void {
    if (!this.viewerInstanceId) {
      return;
    }

    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.MEASUREMENTS_RESTORED,
      { viewerInstanceId: this.viewerInstanceId, measurements },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
  }

  private setToolActive(toolName: string): boolean {
    try {
      this.commandsManager.runCommand('setToolActive', { toolName });
      return true;
    } catch (error) {
      this.onCommandError?.(error);
      return false;
    }
  }

  private readonly tryAnnounceReady = (): void => {
    if (!this.modeActive || this.readyAnnounced || !this.viewerInstanceId) {
      return;
    }

    const { viewportGridService, toolGroupService } = this.services;
    let viewportState: ViewportGridState;
    let toolGroup: ToolGroup | undefined;

    try {
      viewportState = viewportGridService.getState();
      toolGroup = toolGroupService.getToolGroup();
    } catch {
      // OHIF can invoke extension onModeEnter before viewport service implementations are ready.
      // Readiness events and the bounded retry cover asynchronous service initialization.
      this.scheduleReadyRetry();
      return;
    }

    if (!viewportState.activeViewportId || viewportState.viewports.size === 0) {
      this.scheduleReadyRetry();
      return;
    }

    if (!toolGroup) {
      this.scheduleReadyRetry();
      return;
    }

    const supportedTools = SUPPORTED_TOOLS.filter(toolName => toolGroup.hasTool(toolName));
    const message = createBridgeMessage(
      BRIDGE_MESSAGE_TYPES.VIEWER_READY,
      {
        viewerInstanceId: this.viewerInstanceId,
        supportedTools,
        capabilities: {
          measurementDeletion: true,
          measurementFocus: true,
          measurementUpdates: true,
          statePersistence: Boolean(this.annotationRepository && this.persistenceStore),
        },
      },
      this.createId()
    );

    this.bridgeWindow.parent.postMessage(message, this.hostOrigin);
    this.readyAnnounced = true;
    this.cancelReadyRetry();
  };

  private scheduleReadyRetry(): void {
    if (
      this.readyRetryTimer !== null ||
      this.readyRetryIndex >= READY_RETRY_DELAYS_MS.length ||
      !this.modeActive ||
      this.readyAnnounced
    ) {
      return;
    }

    const delay = READY_RETRY_DELAYS_MS[this.readyRetryIndex];
    this.readyRetryIndex += 1;
    this.readyRetryTimer = setTimeout(() => {
      this.readyRetryTimer = null;
      this.tryAnnounceReady();
    }, delay);
  }

  private cancelReadyRetry(): void {
    if (this.readyRetryTimer === null) {
      return;
    }

    clearTimeout(this.readyRetryTimer);
    this.readyRetryTimer = null;
  }
}
