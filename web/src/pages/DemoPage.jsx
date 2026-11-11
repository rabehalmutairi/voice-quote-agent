import { HomePage } from "./HomePage";
import { CustomQuestionFixturePanel } from "../features/taskFlow/CustomQuestionFixturePanel";

export function DemoPage() {
  return (
    <>
      <HomePage mode="demo" />
      <CustomQuestionFixturePanel />
    </>
  );
}
