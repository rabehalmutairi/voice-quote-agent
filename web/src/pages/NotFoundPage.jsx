import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="foundation-panel" aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">الصفحة غير موجودة</h1>
      <p className="lead">تحقق من الرابط أو ارجع إلى الصفحة الرئيسية.</p>
      <Link className="button-link" to="/">العودة إلى الرئيسية</Link>
    </section>
  );
}
