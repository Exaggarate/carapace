import { QuestionPage } from "./question-page.ts";

if (!customElements.get("carapace-question-page")) {
  customElements.define("carapace-question-page", QuestionPage);
}
