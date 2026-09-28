import { useEffect, useRef, useState } from 'react';
import { ensureSeeded } from './data/repo';
import { maybeSync, syncChangedData } from './data/sync';
import { shouldReloadForUpdate } from './lib/appUpdate';
import { applyRotationLock } from './lib/rotationLock';
import Home from './screens/Home';
import TemplateView from './screens/TemplateView';
import Session from './screens/Session';
import History from './screens/History';
import SessionMarkdown from './screens/SessionMarkdown';
import Backup from './screens/Backup';
import Feedback from './screens/Feedback';
import LogActivity from './screens/LogActivity';
import Progress from './screens/Progress';

/** Five minutes: frequent enough that an open tab stays current, rare enough
 *  that a dataset changing a few times a week is not polled pointlessly. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

type Route =
  | { view: 'home' }
  | { view: 'template'; id: string; edit?: boolean }
  | { view: 'session' }
  | { view: 'history' }
  | { view: 'markdown'; sessionId: string; back?: Route }
  | { view: 'progress'; exerciseId?: string }
  | { view: 'backup' }
  | { view: 'feedback' }
  | { view: 'activity' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ view: 'home' });
  /** Bumped when a sync changed the data, to force list screens to re-read. */
  const [dataVersion, setDataVersion] = useState(0);
  /** Read inside the service-worker listener without re-subscribing on each nav. */
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    ensureSeeded().then(() => setReady(true));
  }, []);

  // Pick up a new build on start instead of leaving the installed app a launch
  // behind — the "why does my phone look different to the website?" problem.
  // The service worker self-activates (registerType: 'autoUpdate'), so all this
  // does is reload the page onto it, under the guards in shouldReloadForUpdate.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;

    const hadController = sw.controller !== null;
    let alreadyReloaded = false;

    function onControllerChange() {
      const reload = shouldReloadForUpdate({
        hadController,
        alreadyReloaded,
        inSession: routeRef.current.view === 'session',
      });
      if (!reload) return;
      alreadyReloaded = true;
      window.location.reload();
    }

    sw.addEventListener('controllerchange', onControllerChange);
    // Ask now rather than waiting for the browser's own update heuristics.
    void sw
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {
        // Offline, or no registration yet — nothing to do.
      });

    return () => sw.removeEventListener('controllerchange', onControllerChange);
  }, []);

  // Rotation lock (F8): apply on start and again on each return to the
  // foreground, since Android can drop the lock while the app is in the
  // background.
  useEffect(() => {
    void applyRotationLock();
    function onVisible() {
      if (document.visibilityState === 'visible') void applyRotationLock();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Sync on start, and whenever the app returns to the foreground. Without this
  // a device stayed stale until someone pressed the button ON THAT DEVICE —
  // which is not what "one shared database" means in practice.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const result = await maybeSync();
      if (!cancelled && syncChangedData(result)) setDataVersion((v) => v + 1);
    }

    void run();

    function onVisible() {
      if (document.visibilityState === 'visible') void run();
    }
    document.addEventListener('visibilitychange', onVisible);

    // A tab left open and focused would otherwise never notice a change made on
    // another device. Only polls while visible, so a backgrounded app costs
    // nothing. maybeSync's own guards mean an unchanged database writes no rows.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-12 pt-6">
      {route.view === 'home' && (
        <Home
          key={`home-${dataVersion}`}
          onOpenTemplate={(id) => setRoute({ view: 'template', id })}
          onEditTemplate={(id) => setRoute({ view: 'template', id, edit: true })}
          onSessionStarted={() => setRoute({ view: 'session' })}
          onOpenHistory={() => setRoute({ view: 'history' })}
          onOpenBackup={() => setRoute({ view: 'backup' })}
          onOpenFeedback={() => setRoute({ view: 'feedback' })}
          onLogActivity={() => setRoute({ view: 'activity' })}
        />
      )}
      {route.view === 'backup' && <Backup onBack={() => setRoute({ view: 'home' })} />}
      {route.view === 'feedback' && <Feedback onBack={() => setRoute({ view: 'home' })} />}
      {route.view === 'activity' && (
        <LogActivity
          onBack={() => setRoute({ view: 'home' })}
          onLogged={() => {
            setDataVersion((v) => v + 1);
            setRoute({ view: 'history' });
          }}
        />
      )}
      {route.view === 'history' && (
        <History
          key={`history-${dataVersion}`}
          onOpenSession={(sessionId) => setRoute({ view: 'markdown', sessionId })}
          onOpenProgress={() => setRoute({ view: 'progress' })}
          onBack={() => setRoute({ view: 'home' })}
        />
      )}
      {route.view === 'progress' && (
        <Progress
          key={`progress-${dataVersion}`}
          exerciseId={route.exerciseId}
          onSelect={(exerciseId) => setRoute({ view: 'progress', exerciseId })}
          onOpenSession={(sessionId) =>
            setRoute({ view: 'markdown', sessionId, back: { view: 'progress', exerciseId: route.exerciseId } })
          }
          onBack={() => setRoute({ view: 'history' })}
        />
      )}
      {route.view === 'markdown' && (
        <SessionMarkdown
          sessionId={route.sessionId}
          onBack={() => setRoute(route.back ?? { view: 'history' })}
          backLabel={route.back?.view === 'progress' ? 'Progress' : 'History'}
        />
      )}
      {route.view === 'template' && (
        <TemplateView
          id={route.id}
          initialEditing={route.edit ?? false}
          onBack={() => setRoute({ view: 'home' })}
        />
      )}
      {route.view === 'session' && <Session onExit={() => setRoute({ view: 'home' })} />}
    </div>
  );
}
