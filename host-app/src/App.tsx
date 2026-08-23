import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Measurement, SupportedToolName } from '@spsoft/viewer-protocol';

import {
  HostBridgeController,
  type ActivationRequest,
  type ActivationResult,
} from './bridge/HostBridgeController';
import { resolveViewerOrigin } from './config/viewerConfiguration';
import {
  hasActiveDrawing,
  initialScoringState,
  scoringReducer,
  type MeasurementRow,
  type MeasurementRowStatus,
  type ScoringState,
} from './scoring/state';
import {
  getRestorableMeasurementBindings,
  loadPersistedRows,
  savePersistedRows,
} from './scoring/persistence';
import { calculateAreaTotals, calculateLengthTotals } from './scoring/totals';

const DEFAULT_VIEWER_STUDY_UID = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5';
const ELLIPSE_TOOL: SupportedToolName = 'EllipticalROI';
const LENGTH_TOOL: SupportedToolName = 'Length';
const MEASUREMENT_NUMBER_FORMATTER = new Intl.NumberFormat('uk-UA', {
  maximumFractionDigits: 2,
});

const toolCopy: Record<
  SupportedToolName,
  { activationLabel: string; drawingDescription: string; rowTitle: string; shortLabel: string }
> = {
  EllipticalROI: {
    activationLabel: 'Активувати Ellipse',
    drawingDescription: 'Намалюйте еліпс на зображенні',
    rowTitle: 'Площа ураження',
    shortLabel: 'Площа',
  },
  Length: {
    activationLabel: 'Активувати Length',
    drawingDescription: 'Проведіть лінію на зображенні',
    rowTitle: 'Довжина',
    shortLabel: 'Довжина',
  },
};

const viewerConfiguration = resolveViewerOrigin(import.meta.env.VITE_VIEWER_ORIGIN);
const viewerOrigin = viewerConfiguration.origin;
const viewerOriginLabel = new URL(viewerOrigin).host;
const viewerStudyUid = import.meta.env.VITE_VIEWER_STUDY_UID || DEFAULT_VIEWER_STUDY_UID;
const viewerUrl = new URL('/viewer', viewerOrigin);

viewerUrl.searchParams.set('StudyInstanceUIDs', viewerStudyUid);

if (viewerConfiguration.warning) {
  console.warn(viewerConfiguration.warning);
}

const statusCopy: Record<MeasurementRowStatus, { label: string; description: string }> = {
  waiting: { label: 'Очікує', description: 'Готове до активації' },
  queued: { label: 'У черзі', description: 'Очікуємо готовність Viewer' },
  drawing: { label: 'Малювання…', description: 'Завершіть вимірювання у Viewer' },
  restoring: { label: 'Відновлення…', description: 'Відновлюємо анотацію у Viewer' },
  ready: { label: 'Готово', description: 'Вимірювання отримано' },
  deleting: { label: 'Видалення…', description: 'Очікуємо підтвердження від Viewer' },
  error: { label: 'Помилка', description: 'Не вдалося активувати інструмент' },
};

interface ViewerFrameProps {
  bridgeInstalled: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  onLoad: () => void;
}

function ViewerFrame({ bridgeInstalled, iframeRef, onLoad }: ViewerFrameProps) {
  return (
    <section
      className="viewer-panel"
      aria-label="OHIF Viewer"
    >
      <div className="viewer-panel__label">
        <span className="viewer-panel__pulse" />
        <span>OHIF Viewer</span>
        <span className="viewer-panel__origin">{viewerOriginLabel}</span>
      </div>

      {bridgeInstalled ? (
        <iframe
          ref={iframeRef}
          className="viewer-panel__frame"
          src={viewerUrl.toString()}
          title="OHIF medical image viewer"
          onLoad={onLoad}
          allow="fullscreen"
          allowFullScreen
        />
      ) : (
        <div
          className="viewer-panel__boot"
          role="status"
        >
          Підготовка захищеного каналу…
        </div>
      )}
    </section>
  );
}

function EmptyMeasurements() {
  return (
    <div className="empty-state">
      <div
        className="empty-state__mark"
        aria-hidden="true"
      >
        <span />
      </div>
      <p className="empty-state__title">Вимірювань ще немає</p>
      <p className="empty-state__description">
        Додайте рядок площі або довжини та активуйте відповідний інструмент у Viewer.
      </p>
    </div>
  );
}

interface MeasurementRowItemProps {
  busy: boolean;
  focusSupported: boolean;
  index: number;
  onActivate: (row: MeasurementRow) => void;
  onCancel: (row: MeasurementRow) => void;
  onDelete: (row: MeasurementRow) => void;
  onFocus: (row: MeasurementRow) => void;
  row: MeasurementRow;
}

function MeasurementRowItem({
  busy,
  focusSupported,
  index,
  onActivate,
  onCancel,
  onDelete,
  onFocus,
  row,
}: MeasurementRowItemProps) {
  const copy = statusCopy[row.status];
  const measurementCopy = toolCopy[row.toolName];
  const isActive = row.status === 'queued' || row.status === 'drawing';
  const canActivate = (row.status === 'waiting' || row.status === 'error') && !busy;
  const canFocus = row.status === 'ready' && focusSupported && !busy;
  const measurementValue = row.measurement
    ? `${MEASUREMENT_NUMBER_FORMATTER.format(row.measurement.value)} ${row.measurement.rawUnit}`
    : '—';
  const errorDescription =
    row.error === 'unsupported'
      ? `${measurementCopy.shortLabel} недоступна у поточному режимі`
      : row.error === 'bridge-error'
        ? 'Канал Viewer тимчасово недоступний'
        : row.status === 'drawing'
          ? measurementCopy.drawingDescription
          : canFocus
            ? 'Клікніть рядок, щоб показати анотацію у Viewer'
            : copy.description;

  return (
    <article
      className={`measurement-row measurement-row--${row.status}`}
      data-row-id={row.id}
      data-tool-name={row.toolName}
    >
      {canFocus ? (
        <button
          className="measurement-row__focus-target"
          type="button"
          aria-label={`Показати вимірювання ${index + 1} у Viewer`}
          onClick={() => onFocus(row)}
        />
      ) : null}

      <div className="measurement-row__heading">
        <div>
          <span className="measurement-row__index">{String(index + 1).padStart(2, '0')}</span>
          <h2>{measurementCopy.rowTitle}</h2>
        </div>
        <output className="measurement-row__value">{measurementValue}</output>
      </div>

      <div className="measurement-row__meta">
        <span className="measurement-row__status">
          <span aria-hidden="true" />
          {copy.label}
        </span>
        <p>{errorDescription}</p>
      </div>

      {row.status === 'restoring' ? (
        <button
          className="measurement-row__button"
          type="button"
          disabled
        >
          Відновлення…
        </button>
      ) : row.status === 'deleting' ? (
        <button
          className="measurement-row__button measurement-row__button--delete"
          type="button"
          disabled
        >
          Видалення…
        </button>
      ) : isActive ? (
        <button
          className="measurement-row__button measurement-row__button--cancel"
          type="button"
          onClick={() => onCancel(row)}
        >
          Скасувати
        </button>
      ) : row.status === 'ready' ? (
        <button
          className="measurement-row__button measurement-row__button--delete"
          type="button"
          onClick={() => onDelete(row)}
        >
          Видалити
        </button>
      ) : (
        <button
          className="measurement-row__button"
          type="button"
          disabled={!canActivate}
          onClick={() => onActivate(row)}
        >
          {measurementCopy.activationLabel}
        </button>
      )}
    </article>
  );
}

interface ScoringPanelProps {
  bridgeInstalled: boolean;
  onActivate: (row: MeasurementRow) => void;
  onAddRow: (toolName: SupportedToolName) => void;
  onCancel: (row: MeasurementRow) => void;
  onDelete: (row: MeasurementRow) => void;
  onFocus: (row: MeasurementRow) => void;
  state: ScoringState;
}

function ScoringPanel({
  bridgeInstalled,
  onActivate,
  onAddRow,
  onCancel,
  onDelete,
  onFocus,
  state,
}: ScoringPanelProps) {
  const connected = state.connection.status === 'ready';
  const ellipseSupported =
    state.connection.status === 'ready' && state.connection.supportedTools.includes(ELLIPSE_TOOL);
  const lengthSupported =
    state.connection.status === 'ready' && state.connection.supportedTools.includes(LENGTH_TOOL);
  const focusSupported =
    state.connection.status === 'ready' && state.connection.capabilities.measurementFocus;
  const connectionLabel = !connected
    ? 'Підключення до Viewer…'
    : ellipseSupported || lengthSupported
      ? 'Viewer підключено'
      : 'Інструменти недоступні';
  const busy = hasActiveDrawing(state);
  const areaTotals = calculateAreaTotals(state.rows);
  const lengthTotals = calculateLengthTotals(state.rows);

  return (
    <aside
      className="scoring-panel"
      aria-labelledby="scoring-title"
    >
      <header className="scoring-panel__header">
        <div className="scoring-panel__context">
          <p className="eyebrow">Clinical scoring</p>
          <span
            className={`connection-state ${connected ? 'connection-state--ready' : ''}`}
            role="status"
          >
            <span className="connection-state__dot" />
            {connectionLabel}
          </span>
        </div>

        <h1 id="scoring-title">Форма вимірювань</h1>
        <p className="scoring-panel__intro">
          Створіть рядок, активуйте інструмент і завершіть вимірювання у Viewer.
        </p>
      </header>

      <div
        className="add-measurement-group"
        aria-label="Додати тип вимірювання"
      >
        <button
          className="add-measurement"
          type="button"
          disabled={!bridgeInstalled}
          onClick={() => onAddRow(ELLIPSE_TOOL)}
        >
          <span aria-hidden="true">＋</span>
          Додати площу
        </button>
        <button
          className="add-measurement add-measurement--secondary"
          type="button"
          disabled={!bridgeInstalled}
          onClick={() => onAddRow(LENGTH_TOOL)}
        >
          <span aria-hidden="true">＋</span>
          Додати довжину
        </button>
      </div>

      <div
        className={`measurement-list ${state.rows.length ? 'measurement-list--filled' : ''}`}
        aria-live="polite"
      >
        {state.rows.length ? (
          state.rows.map((row, index) => (
            <MeasurementRowItem
              key={row.id}
              row={row}
              index={index}
              busy={busy && row.status !== 'queued' && row.status !== 'drawing'}
              focusSupported={focusSupported}
              onActivate={onActivate}
              onCancel={onCancel}
              onDelete={onDelete}
              onFocus={onFocus}
            />
          ))
        ) : (
          <EmptyMeasurements />
        )}
      </div>

      <footer
        className="scoring-totals"
        aria-live="polite"
      >
        <MeasurementTotals
          kind="area"
          label="Площа"
          totals={areaTotals}
        />
        <MeasurementTotals
          kind="length"
          label="Довжина"
          totals={lengthTotals}
        />
      </footer>
    </aside>
  );
}

interface MeasurementTotalsProps {
  kind: Measurement['kind'];
  label: string;
  totals: Array<{ displayUnit: string; key: string; value: number }>;
}

function MeasurementTotals({ kind, label, totals }: MeasurementTotalsProps) {
  return (
    <section
      className="scoring-total"
      data-total-kind={kind}
    >
      <span>{label}</span>
      <div className="scoring-total__values">
        {totals.length ? (
          totals.map(total => (
            <output
              key={total.key}
              aria-label={`${label} разом ${total.displayUnit}`}
              data-total-key={total.key}
            >
              {MEASUREMENT_NUMBER_FORMATTER.format(total.value)} {total.displayUnit}
            </output>
          ))
        ) : (
          <output>—</output>
        )}
      </div>
    </section>
  );
}

function outcomeForReducer(result: ActivationResult) {
  return result === 'busy' ? null : result;
}

export function App() {
  const [state, dispatch] = useReducer(scoringReducer, initialScoringState, initialState => ({
    ...initialState,
    rows: loadPersistedRows(window.localStorage, viewerStudyUid),
  }));
  const [bridgeInstalled, setBridgeInstalled] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<HostBridgeController | null>(null);
  const rowsRef = useRef(state.rows);
  rowsRef.current = state.rows;

  useEffect(() => {
    savePersistedRows(window.localStorage, viewerStudyUid, state.rows);
  }, [state.rows]);

  useEffect(() => {
    const bridge = new HostBridgeController({
      hostWindow: window,
      viewerOrigin,
      getViewerWindow: () => iframeRef.current?.contentWindow ?? null,
      createId: () => window.crypto.randomUUID(),
      callbacks: {
        onViewerReady: payload => dispatch({ type: 'viewerReady', payload }),
        onActivationSent: request => dispatch({ type: 'activationSent', ...request }),
        onActivationRejected: (request, reason) =>
          dispatch({ type: 'activationRejected', ...request, reason }),
        onActivationReset: request => dispatch({ type: 'activationReset', ...request }),
        onMeasurementAdded: payload => dispatch({ type: 'measurementReceived', payload }),
        onMeasurementRemoved: payload => dispatch({ type: 'measurementRemoved', payload }),
        onMeasurementsRestored: payload => dispatch({ type: 'measurementsRestored', payload }),
        onMeasurementUpdated: payload => dispatch({ type: 'measurementUpdated', payload }),
        onViewerLoading: () => dispatch({ type: 'viewerLoading' }),
      },
      getRestorableMeasurements: () => getRestorableMeasurementBindings(rowsRef.current),
    });

    bridgeRef.current = bridge;
    bridge.install();
    setBridgeInstalled(true);

    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, []);

  const handleAddRow = useCallback((toolName: SupportedToolName) => {
    dispatch({ type: 'rowAdded', rowId: window.crypto.randomUUID(), toolName });
  }, []);

  const handleViewerLoad = useCallback(() => {
    bridgeRef.current?.notifyViewerLoading();
  }, []);

  const handleActivate = useCallback((row: MeasurementRow) => {
    const bridge = bridgeRef.current;

    if (!bridge) {
      return;
    }

    const activationId = window.crypto.randomUUID();
    const request: ActivationRequest = {
      rowId: row.id,
      activationId,
      toolName: row.toolName,
    };
    const outcome = outcomeForReducer(bridge.activate(request));

    if (outcome) {
      dispatch({ type: 'activationRequested', rowId: row.id, activationId, outcome });
    }
  }, []);

  const handleCancel = useCallback((row: MeasurementRow) => {
    if (!row.activationId) {
      return;
    }

    const request: ActivationRequest = {
      rowId: row.id,
      activationId: row.activationId,
      toolName: row.toolName,
    };
    bridgeRef.current?.cancel(request);
    dispatch({ type: 'activationCancelled', rowId: row.id, activationId: row.activationId });
  }, []);

  const handleDelete = useCallback((row: MeasurementRow) => {
    if (!row.annotationId) {
      return;
    }

    const outcome = bridgeRef.current?.removeMeasurement({
      rowId: row.id,
      annotationId: row.annotationId,
    });

    if (outcome === 'sent') {
      dispatch({ type: 'deletionRequested', rowId: row.id, annotationId: row.annotationId });
    }
  }, []);

  const handleFocus = useCallback((row: MeasurementRow) => {
    if (!row.annotationId) {
      return;
    }

    bridgeRef.current?.focusMeasurement({
      rowId: row.id,
      annotationId: row.annotationId,
    });
  }, []);

  return (
    <main className="workspace">
      <ViewerFrame
        bridgeInstalled={bridgeInstalled}
        iframeRef={iframeRef}
        onLoad={handleViewerLoad}
      />
      <ScoringPanel
        bridgeInstalled={bridgeInstalled}
        state={state}
        onAddRow={handleAddRow}
        onActivate={handleActivate}
        onCancel={handleCancel}
        onDelete={handleDelete}
        onFocus={handleFocus}
      />
    </main>
  );
}
