import { NavLink } from "react-router-dom";

export function TaskTabs() {
  return <nav className="task-tabs" aria-label="تنقل الطلب"><NavLink to="/tracking">تتبع طلبك</NavLink><NavLink to="/comparison">مقارنة العروض</NavLink></nav>;
}

export function JourneyProgress({ steps, current }) {
  return <ol className="journey-progress" aria-label="مراحل الطلب">{steps.map((step, index) => <li key={step} aria-current={index === current ? "step" : undefined} data-state={index < current ? "complete" : index === current ? "current" : "upcoming"}><span aria-hidden="true">{new Intl.NumberFormat("ar-SA").format(index + 1)}</span>{step}</li>)}</ol>;
}
