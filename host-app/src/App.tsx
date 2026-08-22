const DEFAULT_VIEWER_ORIGIN = 'http://localhost:3000';
const DEFAULT_VIEWER_STUDY_UID = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5';

const viewerOrigin = import.meta.env.VITE_VIEWER_ORIGIN || DEFAULT_VIEWER_ORIGIN;
const viewerStudyUid = import.meta.env.VITE_VIEWER_STUDY_UID || DEFAULT_VIEWER_STUDY_UID;
const viewerUrl = new URL('/viewer', viewerOrigin);

viewerUrl.searchParams.set('StudyInstanceUIDs', viewerStudyUid);

function ViewerFrame() {
  return (
    <section
      className="viewer-panel"
      aria-label="OHIF Viewer"
    >
      <div className="viewer-panel__label">
        <span className="viewer-panel__pulse" />
        <span>OHIF Viewer</span>
        <span className="viewer-panel__port">:3000</span>
      </div>

      <iframe
        className="viewer-panel__frame"
        src={viewerUrl.toString()}
        title="OHIF medical image viewer"
        allow="fullscreen"
        allowFullScreen
      />
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
        Після підключення bridge тут з’являться площі анотацій із Viewer.
      </p>
    </div>
  );
}

function ScoringPanel() {
  return (
    <aside
      className="scoring-panel"
      aria-labelledby="scoring-title"
    >
      <header className="scoring-panel__header">
        <div className="scoring-panel__context">
          <p className="eyebrow">Clinical scoring</p>
          <span
            className="connection-state"
            aria-label="Viewer bridge ще не підключено"
          >
            <span className="connection-state__dot" />
            Очікує bridge
          </span>
        </div>

        <h1 id="scoring-title">Форма вимірювань</h1>
        <p className="scoring-panel__intro">
          Створюйте вимірювання у формі та малюйте відповідні анотації у Viewer.
        </p>
      </header>

      <button
        className="add-measurement"
        type="button"
        disabled
        title="Буде підключено разом із viewer bridge"
      >
        <span aria-hidden="true">＋</span>
        Додати вимірювання
      </button>

      <div className="measurement-list">
        <EmptyMeasurements />
      </div>

      <footer className="scoring-total">
        <span>Разом</span>
        <output>0.0 mm²</output>
      </footer>
    </aside>
  );
}

export function App() {
  return (
    <main className="workspace">
      <ViewerFrame />
      <ScoringPanel />
    </main>
  );
}
