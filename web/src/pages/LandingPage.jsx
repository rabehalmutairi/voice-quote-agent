import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "../components/ui/Icon";

const STEPS = [
  { icon: "quote", title: "قل لنا وش تحتاج", detail: "اكتب طلبك، أو عبّئ التفاصيل. قارن عروضًا أو اسأل محلاً تختاره." },
  { icon: "phone", title: "راجع الطلب وتابع", detail: "في «اسأل عني» تختار المحل وتؤكد الاتصال. وتتابع حالة كل طلب من مكان واحد." },
  { icon: "compare", title: "خذ قرارك على بيّنة", detail: "راجع الإجابات وافتح دليل المعلومة. ما لم يذكره المحل يظهر بوضوح." },
];

/** A single synthetic offer explains the evidence experience without implying a live task. */
function OfferPreview() {
  return (
    <aside className="offer-preview" aria-labelledby="offer-preview-title">
      <div className="offer-preview__caption"><span>مثال على النتيجة</span><span className="preview-badge">محاكاة</span></div>
      <div className="offer-preview__request"><Icon name="phone" /><div><span>طلب صيانة</span><h2 id="offer-preview-title">تغيير شاشة آيفون ١٥ برو</h2></div></div>
      <p className="offer-preview__source" role="note">معاينة محاكاة · ليست نتيجة اتصال حقيقي</p>
      <div className="offer-preview__price"><span>السعر الذي ذكره المحل</span><p><strong>{new Intl.NumberFormat("ar-SA").format(450)}</strong><span>ريال</span></p></div>
      <dl className="offer-preview__facts"><div><dt>نوع القطعة</dt><dd>تجاري</dd></div><div><dt>الضمان</dt><dd>٣٠ يومًا</dd></div><div><dt>وقت الإنجاز</dt><dd>٤٥ دقيقة</dd></div></dl>
      <details className="offer-preview__evidence" open>
        <summary><Icon name="quote" /> من وين جاء السعر؟</summary>
        <blockquote>«التجاري بأربعمية وخمسين.»</blockquote>
        <p>عبارة من محادثة المحاكاة، مرتبطة بالسعر ونوع القطعة.</p>
      </details>
      <p className="offer-preview__footnote"><Icon name="info" /> عرض توضيحي واحد؛ لا يعني أنه الأرخص.</p>
    </aside>
  );
}

export function LandingPage() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <div className="landing-page" dir="rtl">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__copy">
          <p className="landing-eyebrow"><span aria-hidden="true" /> سؤال للمحل. وقت لك.</p>
          <h1 id="landing-title">من وصف المشكلة<br /><span>إلى إجابة واضحة.</span></h1>
          <p className="landing-lead">قارن عروض الصيانة، أو اسأل محلاً تختاره. الإجابة تجيك ومعها دليلها من المكالمة.</p>
          <div className="landing-actions"><Link className="landing-primary" to="/request">ابدأ طلبك <Icon name="arrow" /></Link><a className="landing-secondary" href="#how-it-works">كيف تعمل الخدمة؟</a></div>
          <p className="landing-availability"><Icon name="info" /> جرّبها الآن ببيانات محاكاة. لا تُجرى مكالمات حقيقية.</p>
        </div>
        <OfferPreview />
      </section>

      <section id="how-it-works" className="landing-workflow" aria-labelledby="workflow-title">
        <header className="landing-section-heading"><p className="landing-eyebrow">من الطلب إلى القرار</p><h2 id="workflow-title">ثلاث خطوات. والصورة أوضح.</h2></header>
        <ol>{STEPS.map((step, index) => <li key={step.title}><div className="landing-step-icon"><Icon name={step.icon} /><span>{new Intl.NumberFormat("ar-SA").format(index + 1)}</span></div><h3>{step.title}</h3><p>{step.detail}</p></li>)}</ol>
      </section>

      <section id="about" className="landing-principle" aria-labelledby="about-title">
        <div id="benefits"><p className="landing-eyebrow">التفاصيل المهمة، بدون تخمين</p><h2 id="about-title">كل معلومة، ومعها دليلها.</h2><p>نوضح السعر ونوع القطعة والضمان كما وردت في المكالمة. وإذا ما تكفي التفاصيل للمقارنة، نوضح السبب.</p></div>
        <div className="landing-principle__action"><p>أنت تختار بناءً على الإجابة، والقرار لك.</p><Link className="landing-primary" to="/request">جرّب الخدمة <Icon name="arrow" /></Link></div>
      </section>
    </div>
  );
}
