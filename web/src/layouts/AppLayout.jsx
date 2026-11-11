import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { TaskJourneyProvider } from "../features/taskFlow/TaskJourneyProvider";
import { useTaskJourney } from "../features/taskFlow/TaskJourneyContext";
import { Icon } from "../components/ui/Icon";

const THEME_STORAGE_KEY = "voice-quote-theme";
const REFERENCE_PATHS = new Set(["/tracking", "/comparison", "/metrics"]);

function getInitialTheme() {
  if (typeof window === "undefined") {
    return "dark";
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Keep the dark default when storage is unavailable.
  }

  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function AppShell() {
  const journey = useTaskJourney();
  const activeTask = journey.activeProductMode === "quick" ? journey.quickCall.taskState : journey.taskState;
  const location = useLocation();
  const mainRef = useRef(null);
  const previousPathnameRef = useRef(location.pathname);
  const [theme, setTheme] = useState(getInitialTheme);
  const isReferencePage = REFERENCE_PATHS.has(location.pathname);

  useEffect(() => {
    if (previousPathnameRef.current !== location.pathname) {
      previousPathnameRef.current = location.pathname;
      mainRef.current?.focus({ preventScroll: true });
      if (!location.hash) {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    }
  }, [location.pathname, location.hash]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The theme still works for this session if storage is unavailable.
    }
  }, [theme]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
      <div className={`app-shell font-arabic${isReferencePage ? " app-shell--reference" : ""}`}>
        <a className="skip-link" href="#main-content">تخطي إلى المحتوى الرئيسي</a>
        <header className="site-header">
          <div className="site-header__layout">
            <Link className="brand tw-focus-ring" to="/" aria-label="دليل الحي · Voice Quote Agent، الصفحة الرئيسية">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 44 44" focusable="false">
                  <path d="M14.5 11.5c-1.7 0-3.1 1.5-3.1 3.3 0 10.2 7.6 17.8 17.8 17.8 1.8 0 3.3-1.4 3.3-3.1v-3.2c0-.7-.4-1.3-1-1.6l-4.2-2.1c-.7-.3-1.5-.2-2 .4l-1.7 2.1a13 13 0 0 1-4.7-4.7l2.1-1.7c.6-.5.7-1.3.4-2l-2.1-4.2c-.3-.6-.9-1-1.6-1h-3.2Z" />
                  <path d="M28.5 10.5c3.5 1 5.9 3.4 6.9 6.9M30.6 5.2c5.9 1.5 9.7 5.3 11.2 11.2" />
                </svg>
              </span>
              <span className="brand__copy">
                <span className="brand__name">دليل الحي</span>
                <span className="brand__tagline" lang="en" dir="ltr">Voice Quote Agent</span>
              </span>
            </Link>
            <nav className="site-navigation" aria-label="التنقل الرئيسي">
              <ul>
                <li><NavLink to="/" end>الرئيسية</NavLink></li>
                <li><NavLink to="/request">ابدأ طلبك</NavLink></li>
                {activeTask.taskId && <li><NavLink to="/tracking">طلبك الحالي</NavLink></li>}
                <li>
                  <button
                    className="theme-toggle"
                    type="button"
                    aria-label={nextTheme === "light" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"}
                    aria-pressed={theme === "light"}
                    onClick={() => setTheme(nextTheme)}
                  >
                    <Icon name={nextTheme === "light" ? "sun" : "moon"} />
                    <span>{nextTheme === "light" ? "فاتح" : "داكن"}</span>
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        <main ref={mainRef} id="main-content" className="main-content" tabIndex="-1">
          <Suspense fallback={<p role="status">جاري فتح الصفحة…</p>}><Outlet /></Suspense>
        </main>
        <footer className="site-footer">
          <p>كل معلومة مؤكدة مرتبطة بعبارة قالها المحل في المكالمة.</p>
          <nav aria-label="أدوات المشروع"><Link to="/demo">العرض التجريبي</Link><Link to="/metrics">لوحة المقاييس</Link></nav>
        </footer>
      </div>
  );
}

export function AppLayout() {
  return <TaskJourneyProvider><AppShell /></TaskJourneyProvider>;
}
