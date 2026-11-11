import { Link } from "react-router-dom";

export function LoginPage() {
  return (
    <section className="utility-page" dir="rtl" aria-labelledby="login-title">
      <p className="marketing-eyebrow"><span /> حسابك</p>
      <h1 id="login-title">تسجيل الدخول</h1>
      <p>سيظهر تسجيل الدخول هنا عند تفعيل حسابات المستخدمين. يمكنك البدء بطلب صيانة الآن بدون حساب.</p>
      <Link className="marketing-button marketing-button--primary" to="/request">ابدأ طلبك <span aria-hidden="true">↗</span></Link>
    </section>
  );
}
