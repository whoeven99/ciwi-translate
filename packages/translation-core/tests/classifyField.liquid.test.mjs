import assert from "node:assert/strict";
import test from "node:test";
import { classifyField } from "../.build/llmTranslate.js";

const EMAIL_TITLE =
  "{{ shop.name }} {{ gift_card.initial_value | money_without_trailing_zeros }} gift card{% if gift_card.recipient and gift_card.customer %} from {% if gift_card.customer.name != blank %}{{ gift_card.customer.name }}{% elsif gift_card.customer.email != blank %}{{ gift_card.customer.email }}{% else %}{{ gift_card.customer.phone }}{% endif %}{% endif %}";

test("EMAIL_TEMPLATE title (Liquid without HTML) → liquid_html", () => {
  assert.equal(classifyField("title", EMAIL_TITLE), "liquid_html");
});

test("HTML + Liquid → liquid_html", () => {
  assert.equal(
    classifyField("body_html", "<p>{% if x %}Hi{% endif %}</p>"),
    "liquid_html",
  );
});

test("HTML without Liquid → html", () => {
  assert.equal(classifyField("body_html", "<p>Hello</p>"), "html");
});

test("plain text without Liquid → plain", () => {
  assert.equal(classifyField("title", "Hello world"), "plain");
});
