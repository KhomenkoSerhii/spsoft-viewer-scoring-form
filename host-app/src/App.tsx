import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { SupportedToolName } from '@spsoft/viewer-protocol';

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

const DEFAULT_VIEWER_STUDY_UID = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5';
const ELLIPSE_TOOL: SupportedToolName = 'EllipticalROI';

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
  drawing: { label: 'Малювання…', description: 'Намалюйте еліпс на зображенні' },
  ready: { label: 'Готово', description: 'Вимірювання отримано' },
  error: { label: 'Помилка', description: 'Не вдалося активувати інструмент' },
};

interface ViewerFrameProps {
  bridgeInstalled: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement>;
}

function ViewerFrame({ bridgeInstalled, iframeRef }: ViewerFrameProps) {
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
        Додайте рядок і активуйте Ellipse, щоб почати малювання у Viewer.
      </p>
    </div>
  );
}

interface MeasurementRowItemProps {
  busy: boolean;
  index: number;
  onActivate: (rowId: string) => void;
  onCancel: (row: MeasurementRow) => void;
  row: MeasurementRow;
}

function MeasurementRowItem({ busy, index, onActivate, onCancel, row }: MeasurementRowItemProps) {
  const copy = statusCopy[row.status];
  const isActive = row.status === 'queued' || row.status === 'drawing';
  const canActivate = (row.status === 'waiting' || row.status === 'error') && !busy;
  const errorDescription =
    row.error === 'unsupported'
      ? 'Ellipse недоступний у поточному режимі'
      : row.error === 'bridge-error'
        ? 'Канал Viewer тимчасово недоступний'
        : copy.description;

  return (
    <article className={`measurement-row measurement-row--${row.status}`}>
      <div className="measurement-row__heading">
        <div>
          <span className="measurement-row__index">{String(index + 1).padStart(2, '0')}</span>
          <h2>Площа ураження</h2>
        </div>
        <span className="measurement-row__value">—</span>
      </div>

      <div className="measurement-row__meta">
        <span className="measurement-row__status">
          <span aria-hidden="true" />
          {copy.label}
        </span>
        <p>{errorDescription}</p>
      </div>

      {isActive ? (
        <button
          className="measurement-row__button measurement-row__button--cancel"
          type="button"
          onClick={() => onCancel(row)}
        >
          Скасувати
        </button>
      ) : (
        <button
          className="measurement-row__button"
          type="button"
          disabled={!canActivate}
          onClick={() => onActivate(row.id)}
        >
          Активувати Ellipse
        </button>
      )}
    </article>
  );
}

interface ScoringPanelProps {
  bridgeInstalled: boolean;
  onActivate: (rowId: string) => void;
  onAddRow: () => void;
  onCancel: (row: MeasurementRow) => void;
  state: ScoringState;
}

function ScoringPanel({
  bridgeInstalled,
  onActivate,
  onAddRow,
  onCancel,
  state,
}: ScoringPanelProps) {
  const connected = state.connection.status === 'ready';
  const ellipseSupported =
    state.connection.status === 'ready' && state.connection.supportedTools.includes(ELLIPSE_TOOL);
  const connectionLabel = !connected
    ? 'Підключення до Viewer…'
    : ellipseSupported
      ? 'Viewer підключено'
      : 'Ellipse недоступний';
  const busy = hasActiveDrawing(state);

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

      <button
        className="add-measurement"
        type="button"
        disabled={!bridgeInstalled}
        onClick={onAddRow}
      >
        <span aria-hidden="true">＋</span>
        Додати вимірювання
      </button>

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
              onActivate={onActivate}
              onCancel={onCancel}
            />
          ))
        ) : (
          <EmptyMeasurements />
        )}
      </div>

      <footer className="scoring-total">
        <span>Разом</span>
        <output>0.0 mm²</output>
      </footer>
    </aside>
  );
}

function outcomeForReducer(result: ActivationResult) {
  return result === 'busy' ? null : result;
}

export function App() {
  const [state, dispatch] = useReducer(scoringReducer, initialScoringState);
  const [bridgeInstalled, setBridgeInstalled] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<HostBridgeController | null>(null);

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
      },
    });

    bridgeRef.current = bridge;
    bridge.install();
    setBridgeInstalled(true);

    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, []);

  const handleAddRow = useCallback(() => {
    dispatch({ type: 'rowAdded', rowId: window.crypto.randomUUID() });
  }, []);

  const handleActivate = useCallback((rowId: string) => {
    const bridge = bridgeRef.current;

    if (!bridge) {
      return;
    }

    const activationId = window.crypto.randomUUID();
    const request: ActivationRequest = { rowId, activationId, toolName: ELLIPSE_TOOL };
    const outcome = outcomeForReducer(bridge.activate(request));

    if (outcome) {
      dispatch({ type: 'activationRequested', rowId, activationId, outcome });
    }
  }, []);

  const handleCancel = useCallback((row: MeasurementRow) => {
    if (!row.activationId) {
      return;
    }

    const request: ActivationRequest = {
      rowId: row.id,
      activationId: row.activationId,
      toolName: ELLIPSE_TOOL,
    };
    bridgeRef.current?.cancel(request);
    dispatch({ type: 'activationCancelled', rowId: row.id, activationId: row.activationId });
  }, []);

  return (
    <main className="workspace">
      <ViewerFrame
        bridgeInstalled={bridgeInstalled}
        iframeRef={iframeRef}
      />
      <ScoringPanel
        bridgeInstalled={bridgeInstalled}
        state={state}
        onAddRow={handleAddRow}
        onActivate={handleActivate}
        onCancel={handleCancel}
      />
    </main>
  );
}
