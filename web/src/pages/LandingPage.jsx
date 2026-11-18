import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/ui/Icon";

const JOURNEY = [
  {
    title: "قل وش تحتاج",
    description: "اكتب طلبك بطريقتك، مثل: أبي أغير شاشة آيفون ١٥ برو.",
  },
  {
    title: "نرتّب تفاصيله",
    description: "يتحوّل وصفك إلى سؤال واضح يعرف المحل وش المطلوب منه.",
  },
  {
    title: "نسأل المحلات",
    description: "في المقارنة، يروح السؤال لأكثر من محل عشان ترجع لك إجاباتهم.",
  },
  {
    title: "توصلك الردود",
    description: "كل عرض يوضح وش قال المحل عن السعر والقطعة والضمان.",
  },
  {
    title: "تقارن وأنت فاهم",
    description: "شوف المعلومة ومعها العبارة اللي قالها المحل وتأكد منها.",
  },
];

const MOCK_OFFERS = [
  { id: "one", name: "محل ١", price: "٤٥٠", detail: "قطعة تجارية · ضمان ٣٠ يومًا" },
  { id: "two", name: "محل ٢", price: "٥٢٠", detail: "قطعة أصلية · الضمان غير مذكور" },
];

const EVIDENCE = {
  price: { label: "السعر", value: "٤٥٠ ريال", quote: "«التجاري بأربعمية وخمسين.»" },
  part: { label: "نوع القطعة", value: "تجارية", quote: "«القطعة تجارية.»" },
  warranty: { label: "الضمان", value: "٣٠ يومًا", quote: "«وعليها ضمان ثلاثين يوم.»" },
};

function JourneyNode({ className, title, state, onClick, children }) {
  return (
    <button
      className={"journey-node " + className}
      type="button"
      data-state={state}
      aria-pressed={state === "current"}
      onClick={onClick}
    >
      <span className="journey-node__eyebrow">{title}</span>
      {children}
    </button>
  );
}

function SignalOrb({ state, onClick }) {
  return (
    <button
      className="journey-orb-node"
      type="button"
      data-state={state}
      aria-label="انتقل إلى مرحلة ترتيب تفاصيل الطلب"
      aria-pressed={state === "current"}
      onClick={onClick}
    >
      <span className="journey-orb" aria-hidden="true">
        <i className="journey-orb__ring journey-orb__ring--one" />
        <i className="journey-orb__ring journey-orb__ring--two" />
        <i className="journey-orb__shine" />
        <i className="journey-orb__wave"><b /><b /><b /><b /><b /></i>
      </span>
      <span className="journey-orb-node__label">وكيل صوتي</span>
    </button>
  );
}

function JourneyScene({ activeStep, onSelectStep }) {
  const shopState = activeStep === 2 ? "current" : activeStep > 2 ? "done" : "upcoming";
  const replyState = activeStep === 3 ? "current" : activeStep > 3 ? "done" : "upcoming";
  return (
    <div
      className="journey-scene"
      data-stage={activeStep}
      role="group"
      aria-label="مشهد ثلاثي الأبعاد يوضح مراحل الطلب"
    >
      <div className="journey-scene__stars" aria-hidden="true" />
      <div className="journey-scene__floor" aria-hidden="true" />
      <svg className="journey-scene__routes" viewBox="0 0 820 500" preserveAspectRatio="none" aria-hidden="true">
        <path className="journey-route journey-route--request" d="M 650 130 C 565 130 520 205 425 232" />
        <path className="journey-route journey-route--shops" d="M 385 235 C 290 220 257 138 150 130" />
        <path className="journey-route journey-route--reply" d="M 155 172 C 145 260 186 304 205 345" />
        <path className="journey-route journey-route--result" d="M 245 356 C 315 421 374 421 436 420" />
      </svg>

      <JourneyNode
        className="journey-node--request"
        title="طلبك"
        state={activeStep === 0 ? "current" : activeStep > 0 ? "done" : "upcoming"}
        onClick={() => onSelectStep(0)}
      >
        <strong className="journey-node__request">أبي أغير شاشة آيفون ١٥ برو</strong>
        <span className="journey-wave" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
        <span className="journey-node__hint">طلبك بصوتك أو كتابتك</span>
      </JourneyNode>

      <SignalOrb
        state={activeStep === 1 ? "current" : activeStep > 1 ? "done" : "upcoming"}
        onClick={() => onSelectStep(1)}
      />

      <JourneyNode
        className="journey-node--shops"
        title="سؤال واحد · أكثر من محل"
        state={shopState}
        onClick={() => onSelectStep(2)}
      >
        <span className="journey-shop-row"><i /> محل ١ <b>•••</b></span>
        <span className="journey-shop-row"><i /> محل ٢ <b>•••</b></span>
        <span className="journey-node__hint">السؤال في طريقه</span>
      </JourneyNode>

      <JourneyNode
        className="journey-node--reply"
        title="ردود المحلات"
        state={replyState}
        onClick={() => onSelectStep(3)}
      >
        <span className="journey-reply-line"><b>٤٥٠</b> ريال <i /></span>
        <span className="journey-reply-line"><b>٥٢٠</b> ريال <i /></span>
        <span className="journey-node__hint">كل محل يرد بشكل مختلف</span>
      </JourneyNode>

      <JourneyNode
        className="journey-node--result"
        title="مقارنة مع الدليل"
        state={activeStep === 4 ? "current" : activeStep > 4 ? "done" : "upcoming"}
        onClick={() => onSelectStep(4)}
      >
        <span className="journey-result">
          <strong>٤٥٠ <small>ريال</small></strong>
          <span>«التجاري بأربعمية وخمسين.»</span>
        </span>
      </JourneyNode>

      <span className="journey-scene__note">مشهد توضيحي · بيانات تجريبية</span>
    </div>
  );
}

function JourneyDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const current = JOURNEY[activeStep];

  useEffect(() => {
    if (!isPlaying) return undefined;
    const isLastStep = activeStep === JOURNEY.length - 1;
    const timer = window.setTimeout(() => {
      if (isLastStep) setIsPlaying(false);
      else setActiveStep((step) => step + 1);
    }, isLastStep ? 1600 : 2400);
    return () => window.clearTimeout(timer);
  }, [activeStep, isPlaying]);

  function chooseStep(step) {
    setIsPlaying(false);
    setActiveStep(step);
  }

  function togglePlayback() {
    if (activeStep === JOURNEY.length - 1) setActiveStep(0);
    setIsPlaying((playing) => !playing);
  }

  function moveStep(direction) {
    setIsPlaying(false);
    setActiveStep((step) => Math.max(0, Math.min(JOURNEY.length - 1, step + direction)));
  }

  return (
    <section className="journey-demo" aria-label="جرب رحلة الطلب">
      <div className="journey-demo__top">
        <div>
          <span className="journey-demo__eyebrow"><i /> تجربة تفاعلية</span>
          <h2>من كلمة منك إلى جواب واضح</h2>
        </div>
        <span className="journey-demo__count" aria-live="polite">
          <b>{String(activeStep + 1).padStart(2, "0")}</b> / 05
        </span>
      </div>

      <JourneyScene activeStep={activeStep} onSelectStep={chooseStep} />

      <div className="journey-demo__explanation" aria-live="polite">
        <div>
          <span>الخطوة {activeStep + 1} من {JOURNEY.length}</span>
          <h3>{current.title}</h3>
          <p>{current.description}</p>
        </div>
      </div>

      <div className="journey-demo__controls">
        <div className="journey-step-picker" role="group" aria-label="اختر مرحلة من رحلة الطلب">
          {JOURNEY.map((step, index) => (
            <button
              className={activeStep === index ? "is-active" : ""}
              key={step.title}
              type="button"
              aria-label={"الخطوة " + (index + 1) + ": " + step.title}
              aria-pressed={activeStep === index}
              onClick={() => chooseStep(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <i />
            </button>
          ))}
        </div>
        <div className="journey-demo__actions">
          <button className="journey-play" type="button" onClick={togglePlayback} aria-pressed={isPlaying}>
            <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
            {isPlaying ? "إيقاف الرحلة" : "شغّل الرحلة"}
          </button>
          <div className="journey-arrows">
            <button type="button" onClick={() => moveStep(-1)} disabled={activeStep === 0} aria-label="الخطوة السابقة">→</button>
            <button type="button" onClick={() => moveStep(1)} disabled={activeStep === JOURNEY.length - 1} aria-label="الخطوة التالية">←</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceSection() {
  const [activeEvidence, setActiveEvidence] = useState("price");
  const evidence = EVIDENCE[activeEvidence];

  return (
    <section className="story-evidence" aria-labelledby="story-evidence-title">
      <div className="story-evidence__intro">
        <p className="story-eyebrow">كل معلومة لها مصدر</p>
        <h2 id="story-evidence-title">ما نكتفي بالسعر.<br /><span>نوريك وش قال المحل.</span></h2>
        <p>اختر معلومة وشوف كيف تظهر مع العبارة اللي تثبتها. هذا مثال توضيحي ببيانات تجريبية.</p>
      </div>
      <div className="evidence-card">
        <div className="evidence-card__tabs" role="group" aria-label="استكشف تفاصيل العرض">
          {Object.entries(EVIDENCE).map(([key, item]) => (
            <button
              key={key}
              type="button"
              aria-pressed={activeEvidence === key}
              onClick={() => setActiveEvidence(key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="evidence-card__content" key={activeEvidence} aria-live="polite">
          <div className="evidence-card__value">
            <span>{evidence.label}</span>
            <strong>{evidence.value}</strong>
          </div>
          <span className="evidence-card__connector" aria-hidden="true">←</span>
          <blockquote>
            <span>من كلام المحل</span>
            <p>{evidence.quote}</p>
          </blockquote>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="landing-page story-home" lang="ar-SA" dir="rtl">
      <section className="story-hero" aria-labelledby="story-title">
        <div className="story-copy">
          <p className="story-eyebrow"><span className="story-eyebrow__spark" /> اسأل أكثر من محل، بوضوح</p>
          <h1 id="story-title">بدل ما تدور وتسأل،<br /><span>خلّ الجواب يجيك.</span></h1>
          <p className="story-copy__lead">
            اكتب وش تحتاج. نسأل المحلات عنك، ثم نرتب ردودهم في مقارنة واضحة — ومع كل معلومة دليلها من كلام المحل.
          </p>
          <div className="story-copy__actions">
            <Link className="story-cta" to="/request">ابدأ طلبك <Icon name="arrow" /></Link>
            <a className="story-demo-link" href="#journey">شوف كيف تشتغل <span aria-hidden="true">↓</span></a>
          </div>
          <p className="story-copy__note"><i /> العرض التفاعلي التالي يستخدم بيانات تجريبية، ولا ينفّذ اتصالات حقيقية.</p>
        </div>
        <div id="journey" className="story-visual">
          <JourneyDemo />
        </div>
      </section>

      <EvidenceSection />

      <section className="story-finale" aria-labelledby="story-finale-title">
        <div className="story-finale__mark" aria-hidden="true">
          <span /><i /><b />
        </div>
        <div className="story-finale__copy">
          <p className="story-eyebrow">سؤالك هو البداية</p>
          <h2 id="story-finale-title">جاهز تسمع الفرق؟</h2>
          <p>ابدأ بطلبك، وشوف كيف تصير الإجابات أسهل للمقارنة.</p>
        </div>
        <Link className="story-cta" to="/request">ابدأ طلبك <Icon name="arrow" /></Link>
      </section>
    </div>
  );
}

export default LandingPage;
